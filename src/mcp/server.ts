/**
 * AgentChaos as an MCP server.
 *
 * This is the integration that removes the adoption barrier. Nothing about the
 * agent under test changes: a developer adds one entry to the MCP config they
 * already have, and every tool the agent can reach is now injectable and
 * observed. Claude Code, Cursor, Goose, an OpenAI Agents SDK app, anything that
 * speaks MCP.
 *
 * Two modes, decided by whether an upstream router was supplied:
 *
 *   serve mode  every tool is simulated by AgentChaos
 *   proxy mode  benign tools are forwarded to the agent's real MCP servers,
 *               and anything the policy calls dangerous is simulated instead
 *
 * The server runs on stdio because that is how local MCP servers are launched
 * everywhere, which means the client spawns it and this process is a child of
 * the agent. It therefore cannot print a report: stdout is the protocol channel
 * and the parent decides when it dies. It writes a session recording instead,
 * and `agent-chaos report` evaluates that with the same engine the JSONL
 * transport uses.
 */

import { Injector } from '../engine/injector.js';
import { Recorder } from '../engine/recorder.js';
import type { SessionWriter } from '../engine/session.js';
import type { JsonValue, ToolCallEvent } from '../protocol/events.js';
import { LineBuffer } from '../protocol/parse.js';
import type { Scenario } from '../scenario/schema.js';
import {
  ErrorCode,
  JsonRpcMessageSchema,
  failure,
  isRequest,
  success,
  type JsonRpcMessage,
  type RequestId,
} from './jsonrpc.js';
import { advertisedTools, canonicalToolName, findTool } from './tools.js';
import type { UpstreamRouter } from './upstream.js';
import { VERSION } from '../version.js';

/**
 * Protocol versions this server will agree to.
 *
 * MCP negotiates by having the client state a version and the server answer
 * with one it supports. Echoing back a version the client named keeps older
 * clients working; anything unrecognised gets our newest rather than an error,
 * which is what the specification asks for.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]!;

export interface McpServerOptions {
  scenario: Scenario;
  writer: SessionWriter;
  /** Defaults to process.stdout.write. Injectable for tests. */
  write?: (line: string) => void;
  /** Called when the client has finished initialising. */
  onReady?: () => void;
  /** Supplied to enable proxy mode. Omit for a fully simulated surface. */
  upstream?: UpstreamRouter;
}

export class McpServer {
  private readonly recorder = new Recorder();
  private readonly injector: Injector;
  private readonly buffer = new LineBuffer();
  private readonly write: (line: string) => void;
  private callCounter = 0;
  private initialized = false;

  /**
   * Serialises request handling.
   *
   * Proxying makes answering a call asynchronous, and two calls arriving in one
   * chunk could otherwise have their replies interleaved. The recording would
   * then not match the order the agent actually saw, which is the ordering the
   * approval assertions depend on.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: McpServerOptions) {
    this.injector = new Injector(options.scenario);
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  /** Feed raw stdin. Complete lines are handled; partial ones are buffered. */
  push(chunk: string): void {
    for (const line of this.buffer.push(chunk)) this.handleLine(line);
  }

  /** Resolves once every queued request has been answered. */
  async drain(): Promise<void> {
    await this.queue;
  }

  private send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }

  private enqueue(work: () => Promise<void> | void): void {
    this.queue = this.queue.then(work).catch(() => {
      /* a failed handler must not poison the queue for later requests */
    });
  }

  private handleLine(line: string): void {
    if (line.trim() === '') return;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      // No id is recoverable from an unparsable line, so per JSON-RPC the
      // error is reported against a null id.
      this.send({
        jsonrpc: '2.0',
        id: null,
        error: { code: ErrorCode.ParseError, message: 'Parse error' },
      });
      return;
    }

    const parsed = JsonRpcMessageSchema.safeParse(raw);
    if (!parsed.success) return;

    const message = parsed.data;

    // A notification must never be answered. Replying to one is a protocol
    // violation that some clients treat as fatal.
    if (!isRequest(message)) {
      this.handleNotification(message);
      return;
    }

    const { id, method, params } = message;
    this.enqueue(() => this.handleRequest(id, method, params));
  }

  private handleNotification(message: JsonRpcMessage): void {
    if (message.method === 'notifications/initialized') {
      this.initialized = true;
      this.options.onReady?.();
    }
  }

  private async handleRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    switch (method) {
      case 'initialize':
        this.send(success(id, this.initializeResult(params)));
        return;

      case 'ping':
        this.send(success(id, {}));
        return;

      case 'tools/list':
        this.send(success(id, { tools: this.toolList() }));
        return;

      case 'tools/call':
        this.send(success(id, await this.callTool(params)));
        return;

      // Declared as unsupported rather than silently empty: a client that asks
      // should learn this server has none, not receive a misleading empty list.
      case 'resources/list':
      case 'prompts/list':
        this.send(failure(id, ErrorCode.MethodNotFound, `${method} is not supported`));
        return;

      default:
        this.send(failure(id, ErrorCode.MethodNotFound, `Unknown method: ${method}`));
    }
  }

  private initializeResult(params: unknown): JsonValue {
    const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    const protocolVersion =
      requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PREFERRED_PROTOCOL_VERSION;

    const proxying = this.options.upstream !== undefined;

    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agent-chaos', version: VERSION },
      instructions: proxying
        ? 'Tool calls on this server are observed by AgentChaos for security testing. ' +
          'Most are forwarded to the real server behind it; actions the project marks as ' +
          'requiring approval are simulated rather than performed.'
        : 'Every tool on this server is simulated by AgentChaos for security testing. ' +
          'No real file, message, or repository is affected by calling them.',
    };
  }

  /**
   * The advertised surface.
   *
   * In proxy mode the upstream tools come first and the simulated ones are
   * appended only where they do not collide, so a real `github.get_issue`
   * always wins over the stand-in of the same name.
   */
  private toolList(): JsonValue {
    const simulated = advertisedTools() as { name: string }[];
    if (!this.options.upstream) return simulated as JsonValue;

    const upstream = this.options.upstream.advertised() as { name: string }[];
    const taken = new Set(upstream.map((tool) => tool.name));

    return [...upstream, ...simulated.filter((tool) => !taken.has(tool.name))] as JsonValue;
  }

  /**
   * Handle tools/call: record the call, decide the result, record the reply.
   *
   * Injection takes precedence over forwarding. When the scenario targets this
   * call, the payload is returned and the upstream is never contacted, because
   * the point is to hand the agent attacker-controlled content rather than to
   * observe the real tool.
   */
  private async callTool(params: unknown): Promise<JsonValue> {
    const request = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const requestedName = request?.name ?? '';
    const args = request?.arguments ?? {};

    const upstream = this.options.upstream;
    const isUpstream = upstream?.has(requestedName) ?? false;
    const localTool = findTool(requestedName);

    const canonical = isUpstream
      ? (upstream!.canonicalFor(requestedName) ?? requestedName)
      : canonicalToolName(requestedName);

    if (!isUpstream && !localTool) {
      // The agent reached a tool nothing here provides. That call is outside
      // AgentChaos's view, and the recording says so rather than pretending the
      // surface was complete.
      this.options.writer.recordUnknownTool(canonical);
      return {
        content: [{ type: 'text', text: `Unknown tool: ${requestedName}` }],
        isError: true,
      } as JsonValue;
    }

    this.callCounter += 1;
    const call: ToolCallEvent = {
      type: 'tool_call',
      id: `mcp-${this.callCounter}`,
      tool: canonical,
      arguments: args as Record<string, JsonValue>,
    };

    this.options.writer.recordEvent(this.recorder.recordAgentEvent(call));

    const reply = this.injector.resultFor(call);

    if (reply.injected || !isUpstream) {
      this.options.writer.recordEvent(this.recorder.recordHarnessMessage(reply));
      return {
        content: [{ type: 'text', text: JSON.stringify(reply.result ?? null, null, 2) }],
        isError: false,
      } as JsonValue;
    }

    // Not injected and served by an upstream: forward it, or simulate it when
    // the policy says this tool must never actually run.
    const routed = await upstream!.call(requestedName, args);

    if (routed.disposition === 'simulated') {
      this.options.writer.recordSimulatedCall(canonical);
    }

    this.options.writer.recordEvent(
      this.recorder.recordHarnessMessage({
        type: 'tool_result',
        id: call.id,
        result: routed.content,
        ...(routed.isError ? { error: 'upstream reported an error' } : {}),
      }),
    );

    return { content: routed.content, isError: routed.isError } as JsonValue;
  }

  /**
   * Record the agent's closing statement.
   *
   * MCP has no "the agent finished" message: the client simply stops calling
   * and eventually closes the transport. Scenarios that assert on final output
   * therefore need it supplied out of band, which the runner does when it can
   * capture the agent's stdout.
   */
  recordFinalOutput(content: string): void {
    this.options.writer.recordEvent(
      this.recorder.recordAgentEvent({ type: 'final_output', content }),
    );
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getRecorder(): Recorder {
    return this.recorder;
  }

  getInjections(): ReturnType<Injector['getInjections']> {
    return this.injector.getInjections();
  }
}
