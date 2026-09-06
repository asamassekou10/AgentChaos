/**
 * A minimal MCP client, used to talk to upstream servers in proxy mode.
 *
 * This is the mirror of src/mcp/server.ts: there, AgentChaos answers a client;
 * here, it acts as one. Only what a proxy needs is implemented — handshake,
 * tools/list, tools/call — because everything else would be surface area with
 * no caller.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { LineBuffer } from '../protocol/parse.js';
import { splitCommand } from '../transport/jsonl-stdio.js';
import { JSONRPC_VERSION, type RequestId } from './jsonrpc.js';
import { VERSION } from '../version.js';

/** A tool as an upstream server describes it. */
export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface UpstreamToolResult {
  content: unknown;
  isError: boolean;
}

export interface McpClientOptions {
  /** Command to spawn, split on whitespace and run without a shell. */
  command: string;
  cwd: string;
  env?: Record<string, string>;
  /** How long a single request may take before it is abandoned. */
  timeoutMs: number;
}

/** Thrown when an upstream cannot be reached or answers with an error. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly buffer = new LineBuffer();
  private readonly pending = new Map<
    RequestId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 1;
  private stderr = '';
  private closed = false;

  constructor(private readonly options: McpClientOptions) {}

  /**
   * Spawn the server and complete the handshake.
   *
   * Failures here are returned as UpstreamError rather than thrown into the
   * transport, because a proxy that cannot reach one upstream should be able to
   * report that clearly instead of taking the whole run down.
   */
  async start(): Promise<void> {
    const argv = splitCommand(this.options.command);
    const [executable, ...args] = argv;
    if (!executable) throw new UpstreamError('upstream command is empty');

    try {
      this.child = spawn(executable, args, {
        cwd: path.resolve(this.options.cwd),
        env: { ...process.env, ...this.options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new UpstreamError(`could not start upstream: ${(error as Error).message}`);
    }

    const child = this.child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of this.buffer.push(chunk)) this.handleLine(line);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });

    child.stdin.on('error', () => {});

    const abort = (message: string): void => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new UpstreamError(message));
      }
      this.pending.clear();
    };

    // spawn reports a missing executable asynchronously through this event
    // rather than by throwing, so the try/catch above never sees ENOENT.
    // Without a listener it becomes an unhandled exception and takes down the
    // proxy, which is the one process that must survive a bad upstream.
    child.on('error', (error) => abort(`upstream failed to start: ${error.message}`));
    child.on('close', () => abort('upstream closed before answering'));

    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'agent-chaos-proxy', version: VERSION },
    });

    this.notify('notifications/initialized', {});
  }

  private handleLine(line: string): void {
    if (line.trim() === '') return;

    let message: { id?: RequestId; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }

    if (message.id === undefined) return;

    const entry = this.pending.get(message.id);
    if (!entry) return;

    this.pending.delete(message.id);
    clearTimeout(entry.timer);

    if (message.error) {
      entry.reject(new UpstreamError(message.error.message ?? 'upstream returned an error'));
      return;
    }

    entry.resolve(message.result);
  }

  private send(message: unknown): void {
    if (!this.child || this.closed || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      // A hung upstream must not hang the agent under test. The timeout is per
      // request so one slow tool cannot stall the whole session.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new UpstreamError(`upstream did not answer ${method} within ${this.options.timeoutMs}ms`),
        );
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: JSONRPC_VERSION, id, method, params });
    });
  }

  async listTools(): Promise<UpstreamTool[]> {
    const result = (await this.request('tools/list', {})) as { tools?: UpstreamTool[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<UpstreamToolResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: unknown;
      isError?: boolean;
    };

    return { content: result?.content ?? null, isError: result?.isError === true };
  }

  getStderr(): string {
    return this.stderr;
  }

  stop(): void {
    this.closed = true;
    for (const [, entry] of this.pending) clearTimeout(entry.timer);
    this.pending.clear();

    if (!this.child) return;
    try {
      this.child.stdin.end();
    } catch {
      /* already closed */
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
  }
}
