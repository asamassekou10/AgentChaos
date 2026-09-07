/**
 * Upstream routing for proxy mode.
 *
 * In proxy mode the agent connects to AgentChaos and AgentChaos connects to the
 * agent's real MCP servers. Every call is visible, which is what removes the
 * partial-visibility limitation of serve mode, and the tools behind it are real,
 * which makes the test resemble production.
 *
 * SAFETY
 * ------
 * A naive proxy would break the promise that AgentChaos performs no destructive
 * action: forwarding `filesystem.write` means the write happens.
 *
 * The resolution is that detecting a violation never required the dangerous
 * action to complete. It required observing the attempt. So anything the policy
 * already treats as dangerous is answered here with a simulated result and
 * recorded as attempted, while benign calls are forwarded for realism. The
 * agent sees a plausible success either way, the scenario sees the attempt, and
 * nothing is destroyed.
 *
 * NAMING
 * ------
 * An upstream tool is addressed as `<server>.<tool>` canonically and
 * `<server>__<tool>` over the wire. That maps a GitHub server's `get_issue`
 * onto the `github.get_issue` the built-in scenarios already reference, so a
 * scenario written against simulated tools works unchanged against real ones.
 */

import type { JsonValue } from '../protocol/events.js';
import { matchesPattern } from '../policy/path-match.js';
import { defaultResultFor } from '../engine/injector.js';
import { McpClient, UpstreamError, type UpstreamTool } from './client.js';

export interface UpstreamServerSettings {
  command: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface UpstreamRouterOptions {
  servers: Record<string, UpstreamServerSettings>;
  cwd: string;
  /**
   * Tool patterns that are never forwarded. Answered with a simulated result
   * and recorded as attempted.
   */
  simulateTools: string[];
  /** Reports a problem without taking the session down. */
  onWarning?: (message: string) => void;
}

/** How a call was answered, for the evidence trail. */
export type CallDisposition = 'forwarded' | 'simulated' | 'unavailable';

export interface RoutedResult {
  content: JsonValue;
  isError: boolean;
  disposition: CallDisposition;
}

interface RegisteredTool {
  serverKey: string;
  /** Name the upstream knows it by. */
  upstreamName: string;
  canonicalName: string;
  mcpName: string;
  description: string;
  inputSchema: unknown;
}

/** Wire-safe name for an upstream tool. */
export function upstreamMcpName(serverKey: string, toolName: string): string {
  return `${serverKey}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Canonical dotted name a scenario matches against. */
export function upstreamCanonicalName(serverKey: string, toolName: string): string {
  return `${serverKey}.${toolName}`;
}

export class UpstreamRouter {
  private readonly clients = new Map<string, McpClient>();
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly failedServers: string[] = [];

  constructor(private readonly options: UpstreamRouterOptions) {}

  /**
   * Start every configured server and collect its tools.
   *
   * A server that fails to start is recorded and skipped rather than aborting
   * the run. Its tools are then simply absent, and `getFailedServers` lets the
   * caller say so instead of silently testing a smaller surface.
   */
  async start(): Promise<void> {
    for (const [serverKey, settings] of Object.entries(this.options.servers)) {
      const client = new McpClient({
        command: settings.command,
        cwd: this.options.cwd,
        ...(settings.env !== undefined ? { env: settings.env } : {}),
        timeoutMs: settings.timeoutMs,
      });

      try {
        await client.start();
        const tools = await client.listTools();
        this.register(serverKey, tools);
        this.clients.set(serverKey, client);
      } catch (error) {
        client.stop();
        this.failedServers.push(serverKey);
        this.options.onWarning?.(
          `upstream "${serverKey}" could not be reached: ${(error as Error).message}`,
        );
      }
    }
  }

  private register(serverKey: string, tools: UpstreamTool[]): void {
    for (const tool of tools) {
      const registered: RegisteredTool = {
        serverKey,
        upstreamName: tool.name,
        canonicalName: upstreamCanonicalName(serverKey, tool.name),
        mcpName: upstreamMcpName(serverKey, tool.name),
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema ?? { type: 'object' },
      };

      // A later server never displaces an earlier one's tool. Silent shadowing
      // would mean a call landing somewhere the reader did not expect.
      if (this.tools.has(registered.mcpName)) {
        this.options.onWarning?.(
          `tool name collision on "${registered.mcpName}"; keeping the first registration`,
        );
        continue;
      }

      this.tools.set(registered.mcpName, registered);
    }
  }

  /**
   * Tools to advertise, in MCP's shape.
   *
   * The upstream's own description is passed through unchanged. Appending a
   * note that the call is proxied and observed would put that fact into the
   * context of the agent under test, which is the one place it must not go:
   * an agent that knows it is being watched is not the agent being measured.
   */
  advertised(): JsonValue {
    return [...this.tools.values()].map((tool) => ({
      name: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema as JsonValue,
    })) as JsonValue;
  }

  /** Resolve an advertised name to its canonical form, or null if unknown. */
  canonicalFor(mcpName: string): string | null {
    return this.tools.get(mcpName)?.canonicalName ?? null;
  }

  has(mcpName: string): boolean {
    return this.tools.has(mcpName);
  }

  /** Whether a canonical tool name is one the policy says never to forward. */
  isSimulated(canonicalName: string): boolean {
    return this.options.simulateTools.some((pattern) => matchesPattern(canonicalName, pattern));
  }

  /**
   * Answer a call: forward it, or simulate it when the policy forbids it.
   */
  async call(mcpName: string, args: Record<string, unknown>): Promise<RoutedResult> {
    const tool = this.tools.get(mcpName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${mcpName}` }] as JsonValue,
        isError: true,
        disposition: 'unavailable',
      };
    }

    if (this.isSimulated(tool.canonicalName)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(defaultResultFor(tool.canonicalName), null, 2),
          },
        ] as JsonValue,
        isError: false,
        disposition: 'simulated',
      };
    }

    const client = this.clients.get(tool.serverKey);
    if (!client) {
      return {
        content: [
          { type: 'text', text: `Upstream "${tool.serverKey}" is unavailable.` },
        ] as JsonValue,
        isError: true,
        disposition: 'unavailable',
      };
    }

    try {
      const result = await client.callTool(tool.upstreamName, args);
      return {
        content: (result.content ?? null) as JsonValue,
        isError: result.isError,
        disposition: 'forwarded',
      };
    } catch (error) {
      const message = error instanceof UpstreamError ? error.message : (error as Error).message;
      return {
        content: [{ type: 'text', text: `Upstream error: ${message}` }] as JsonValue,
        isError: true,
        disposition: 'unavailable',
      };
    }
  }

  getFailedServers(): string[] {
    return [...this.failedServers];
  }

  stop(): void {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
  }
}
