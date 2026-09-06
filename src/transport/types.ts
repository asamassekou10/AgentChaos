/**
 * The transport interface.
 *
 * The test engine talks to an agent only through this, so adding an MCP or HTTP
 * transport later means writing one class, not touching the engine. Anything
 * transport-specific (process spawning, JSONL framing, HTTP sessions) lives
 * behind it; anything protocol-level (events, injection, assertions) lives in
 * front.
 */

import type { AgentEvent, HarnessMessage } from '../protocol/events.js';
import type { ParseFailure } from '../protocol/parse.js';

export interface TransportHandlers {
  /** A well-formed event arrived from the agent. */
  onEvent(event: AgentEvent): void | Promise<void>;
  /** A line arrived that was not a well-formed event. */
  onParseFailure(failure: ParseFailure): void;
  /** The agent wrote to stderr. Captured for diagnostics, never asserted on. */
  onStderr(chunk: string): void;
}

/** Why a run stopped. */
export type TransportExitReason =
  | { kind: 'final_output' }
  | { kind: 'exited'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'timeout'; afterMs: number }
  | { kind: 'error'; message: string };

export interface TransportRunResult {
  reason: TransportExitReason;
  stderr: string;
}

export interface Transport {
  /**
   * Start the agent and pump events until it produces a final_output, exits, or
   * the timeout expires. Resolves with why it stopped.
   */
  run(handlers: TransportHandlers): Promise<TransportRunResult>;
  /** Send a message to the agent. No-op once the agent has stopped. */
  send(message: HarnessMessage): void;
}
