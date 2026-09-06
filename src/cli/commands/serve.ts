/**
 * `agent-chaos serve --scenario <id>`
 *
 * Runs AgentChaos as an MCP server on stdio. The agent's MCP client spawns
 * this, so stdout belongs to the protocol and nothing else may be written
 * there. Diagnostics go to stderr; the verdict goes to a session recording that
 * `agent-chaos report` reads afterwards.
 */

import type { LoadedConfig } from '../../config/schema.js';
import type { LoadedScenario } from '../../scenario/schema.js';
import { SessionWriter, sessionPath, type SessionHeader } from '../../engine/session.js';
import { McpServer } from '../../mcp/server.js';

export interface ServeOptions {
  /** Where the session recording is written. Defaults under the config root. */
  sessionFile?: string;
  now?: () => number;
}

export interface ServeHandle {
  server: McpServer;
  writer: SessionWriter;
  sessionFile: string;
  /** Stop the server and close the recording. */
  stop(): void;
}

/**
 * Start the MCP server against a scenario.
 *
 * Returns a handle rather than blocking, so tests can drive it directly and the
 * CLI can wire it to real stdio without a second code path.
 */
export function startMcpServer(
  loaded: LoadedConfig,
  scenarioFile: LoadedScenario,
  options: ServeOptions = {},
): ServeHandle {
  const scenario = scenarioFile.scenario;
  const sessionFile = options.sessionFile ?? sessionPath(loaded.rootDir, scenario.id);
  const now = options.now ?? (() => Date.now());

  const header: SessionHeader = {
    kind: 'agent-chaos-session',
    version: 1,
    scenarioId: scenario.id,
    injectOnTool: scenario.inject.on_tool,
    startedAtMs: now(),
  };

  const writer = new SessionWriter(sessionFile, header);
  const server = new McpServer({ scenario, writer });

  return {
    server,
    writer,
    sessionFile,
    stop: () => writer.close(),
  };
}

/** Attach a server to this process's stdio and keep it alive until stdin ends. */
export function runServeCommand(handle: ServeHandle): void {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => handle.server.push(chunk));

  const finish = (): void => {
    handle.stop();
    process.exit(0);
  };

  process.stdin.on('end', finish);
  process.stdin.on('close', finish);
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);

  process.stderr.write(`agent-chaos: MCP server ready, recording to ${handle.sessionFile}\n`);
}
