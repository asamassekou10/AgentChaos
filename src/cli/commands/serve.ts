/**
 * `agent-chaos serve --scenario <id>`
 *
 * Runs AgentChaos as an MCP server on stdio. The agent's MCP client spawns
 * this, so stdout belongs to the protocol and nothing else may be written
 * there. Diagnostics go to stderr; the verdict goes to a session recording that
 * `agent-chaos report` reads afterwards.
 *
 * When the config declares upstream servers, this also starts them and proxies:
 * benign calls reach the real tools, and anything the policy marks as needing
 * approval is simulated instead of performed.
 */

import { simulatedToolPatterns, type LoadedConfig } from '../../config/schema.js';
import type { LoadedScenario } from '../../scenario/schema.js';
import { SessionWriter, sessionPath, type SessionHeader } from '../../engine/session.js';
import { McpServer } from '../../mcp/server.js';
import { UpstreamRouter, type UpstreamServerSettings } from '../../mcp/upstream.js';

export interface ServeOptions {
  /** Where the session recording is written. Defaults under the config root. */
  sessionFile?: string;
  now?: () => number;
  /** Diagnostics sink. Defaults to stderr, which is the only safe channel. */
  warn?: (message: string) => void;
}

export interface ServeHandle {
  server: McpServer;
  writer: SessionWriter;
  sessionFile: string;
  upstream?: UpstreamRouter;
  /** Stop the server, close upstreams, and close the recording. */
  stop(): void;
}

/**
 * Start the MCP server against a scenario.
 *
 * Returns a handle rather than blocking, so tests can drive it directly and the
 * CLI can wire it to real stdio without a second code path.
 */
export async function startMcpServer(
  loaded: LoadedConfig,
  scenarioFile: LoadedScenario,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const scenario = scenarioFile.scenario;
  const sessionFile = options.sessionFile ?? sessionPath(loaded.rootDir, scenario.id);
  const now = options.now ?? (() => Date.now());
  const warn =
    options.warn ?? ((message: string) => process.stderr.write(`agent-chaos: ${message}\n`));

  const header: SessionHeader = {
    kind: 'agent-chaos-session',
    version: 1,
    scenarioId: scenario.id,
    injectOnTool: scenario.inject.on_tool,
    startedAtMs: now(),
  };

  const writer = new SessionWriter(sessionFile, header);

  const servers = loaded.config.upstream.servers;
  let upstream: UpstreamRouter | undefined;

  if (Object.keys(servers).length > 0) {
    const settings: Record<string, UpstreamServerSettings> = {};
    for (const [key, server] of Object.entries(servers)) {
      settings[key] = {
        command: server.command,
        env: server.env,
        timeoutMs: server.timeout_ms,
      };
    }

    upstream = new UpstreamRouter({
      servers: settings,
      cwd: loaded.rootDir,
      simulateTools: simulatedToolPatterns(loaded.config),
      onWarning: warn,
    });

    await upstream.start();

    for (const failed of upstream.getFailedServers()) {
      writer.recordUnknownTool(`${failed}.*`);
    }
  }

  const server = new McpServer({
    scenario,
    writer,
    ...(upstream !== undefined ? { upstream } : {}),
  });

  return {
    server,
    writer,
    sessionFile,
    ...(upstream !== undefined ? { upstream } : {}),
    stop: () => {
      upstream?.stop();
      writer.close();
    },
  };
}

/** Attach a server to this process's stdio and keep it alive until stdin ends. */
export function runServeCommand(handle: ServeHandle): void {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => handle.server.push(chunk));

  const finish = (): void => {
    // Let queued requests finish before the recording is closed, or the last
    // and most interesting call is the one that goes missing.
    void handle.server.drain().then(() => {
      handle.stop();
      process.exit(0);
    });
  };

  process.stdin.on('end', finish);
  process.stdin.on('close', finish);
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);

  // The assurance that nothing here is real belongs on stderr, not in the MCP
  // instructions or the tool descriptions. Those reach the agent under test,
  // and an agent told it is inside a security harness stops behaving like the
  // agent you wanted to measure. stderr reaches the operator only.
  const mode = handle.upstream ? 'proxy' : 'simulated';
  process.stderr.write(
    `agent-chaos: MCP server ready (${mode}), recording to ${handle.sessionFile}\n`,
  );
  process.stderr.write(
    handle.upstream
      ? 'agent-chaos: benign calls are forwarded to the real servers; tools the policy ' +
          'marks as needing approval are simulated and never performed.\n'
      : 'agent-chaos: every tool is simulated. No real file, message, or repository ' +
          'is affected by this run.\n',
  );
}
