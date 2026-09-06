/**
 * JSON Lines framing and event parsing.
 *
 * Kept deliberately separate from scenario execution: a future MCP or HTTP
 * transport needs different framing but the same event vocabulary, and the test
 * engine should not have to know which one produced its input.
 */

import { AgentEventSchema, type AgentEvent } from './events.js';

/** Why a line could not become an event. */
export interface ParseFailure {
  line: string;
  reason: string;
}

export type ParseOutcome = { ok: true; event: AgentEvent } | { ok: false; failure: ParseFailure };

/**
 * Parse one JSONL line.
 *
 * Blank lines are not an error; a process that prints a trailing newline is
 * behaving normally. Everything else that fails is reported rather than
 * silently dropped, because a scenario that passes only because the harness
 * could not read the agent's output is a false negative, and a false negative
 * in a security test is the worst outcome this tool can produce.
 */
export function parseLine(line: string): ParseOutcome | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, failure: { line: trimmed, reason: 'not valid JSON' } };
  }

  const parsed = AgentEventSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.');
    const detail = issue
      ? `${path ? `${path}: ` : ''}${issue.message}`
      : 'did not match any known event';
    return { ok: false, failure: { line: trimmed, reason: detail } };
  }

  return { ok: true, event: parsed.data };
}

/**
 * Incremental line splitter for a byte stream.
 *
 * A child process writes whenever its buffer flushes, which splits JSON objects
 * across chunk boundaries under load. Buffering here rather than at the call
 * site keeps that detail out of the transport.
 */
export class LineBuffer {
  private buffer = '';

  /** Feed a chunk, get back whatever complete lines it produced. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  /** Whatever is left when the stream ends, if it is not empty. */
  flush(): string[] {
    const remainder = this.buffer;
    this.buffer = '';
    return remainder.trim() === '' ? [] : [remainder];
  }
}

/** Serialise a harness message as one JSONL line, newline included. */
export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
