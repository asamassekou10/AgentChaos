/**
 * Session recordings.
 *
 * In MCP mode the process that observes the agent is not the process that
 * judges it. An MCP stdio server is spawned BY the client, so when a developer
 * points Claude Code or Cursor at AgentChaos, the server is a child of their
 * agent and knows nothing about the test run that will evaluate it.
 *
 * A recording file is the seam. The server appends events as they happen; the
 * evaluator reads them afterwards and runs exactly the same assertion engine
 * the JSONL transport uses. No sockets, no ports, no daemon, and it works
 * whether the agent ran for two seconds in CI or two minutes in an editor.
 *
 * The format is JSON Lines so a crashed or killed server still leaves a
 * readable partial recording. A test that was interrupted should report what it
 * saw, not lose it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { RecordedEvent } from '../protocol/events.js';

export const SESSION_DIR = '.agent-chaos';

/** Written once as the first line, so a reader knows what it is holding. */
export const SessionHeaderSchema = z.object({
  kind: z.literal('agent-chaos-session'),
  version: z.literal(1),
  scenarioId: z.string(),
  /** Tool the scenario injects on, for the evidence trail. */
  injectOnTool: z.string(),
  startedAtMs: z.number(),
});

export type SessionHeader = z.infer<typeof SessionHeaderSchema>;

export interface SessionRecording {
  header: SessionHeader;
  events: RecordedEvent[];
  /**
   * Names the agent called that this server does not serve.
   *
   * A non-empty list means the agent has tools AgentChaos cannot see, so the
   * recording is a partial view and any pass drawn from it is unsupported.
   */
  unknownTools: string[];
}

/** Path for a scenario's recording under a root directory. */
export function sessionPath(rootDir: string, scenarioId: string): string {
  return path.join(rootDir, SESSION_DIR, `session-${scenarioId}.jsonl`);
}

/**
 * Append-only writer.
 *
 * Each line is flushed as it is written rather than buffered, because the
 * common ending for this process is being killed when the agent exits, and a
 * buffered tail would be the most interesting part of the recording.
 */
export class SessionWriter {
  private readonly fd: number;

  constructor(
    readonly filePath: string,
    header: SessionHeader,
  ) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, 'w');
    this.writeLine(header);
  }

  private writeLine(value: unknown): void {
    fs.writeSync(this.fd, `${JSON.stringify(value)}\n`);
  }

  recordEvent(event: RecordedEvent): void {
    this.writeLine({ kind: 'event', event });
  }

  recordUnknownTool(name: string): void {
    this.writeLine({ kind: 'unknown_tool', name });
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}

/**
 * Read a recording back.
 *
 * A malformed line is skipped rather than fatal: the writer may have been
 * killed mid-line, and the events before it are still evidence.
 */
export function readSession(filePath: string): SessionRecording | null {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = source.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;

  let header: SessionHeader;
  try {
    header = SessionHeaderSchema.parse(JSON.parse(lines[0]!));
  } catch {
    return null;
  }

  const events: RecordedEvent[] = [];
  const unknownTools: string[] = [];

  for (const line of lines.slice(1)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = parsed as { kind?: string; event?: RecordedEvent; name?: string };
    if (record.kind === 'event' && record.event) events.push(record.event);
    else if (record.kind === 'unknown_tool' && record.name) unknownTools.push(record.name);
  }

  return { header, events, unknownTools };
}
