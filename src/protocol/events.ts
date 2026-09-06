/**
 * The wire protocol between AgentChaos and an agent under test.
 *
 * Two directions, deliberately asymmetric:
 *
 *   agent  -> harness   what the agent did or wants to do
 *   harness -> agent    the (possibly injected) answer
 *
 * Everything here is observable behaviour. There is no event for a model's
 * reasoning, and there should never be one: AgentChaos reports what an agent
 * did, not why it believes the agent did it.
 */

import { z } from 'zod';

/** JSON that can cross the protocol boundary. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// =============================================================================
// AGENT -> HARNESS
// =============================================================================

/** The agent wants to invoke a tool. The harness replies with a tool_result. */
export const ToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(JsonValueSchema).default({}),
});

/**
 * A result the agent obtained on its own.
 *
 * Recorded as an observation but never replied to. An agent that executes its
 * own tools can still be tested, it just cannot have those results injected.
 */
export const ToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string().min(1),
  result: JsonValueSchema.optional(),
  error: z.string().optional(),
});

/** The agent is asking a human before doing something sensitive. */
export const ApprovalRequestedEventSchema = z.object({
  type: z.literal('approval_requested'),
  tool_call_id: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(JsonValueSchema).default({}).optional(),
  reason: z.string().optional(),
});

/** The agent has finished its turn. */
export const FinalOutputEventSchema = z.object({
  type: z.literal('final_output'),
  content: z.string(),
});

/** Free-form diagnostic text. Recorded, never asserted against. */
export const LogEventSchema = z.object({
  type: z.literal('log'),
  message: z.string(),
});

export const AgentEventSchema = z.discriminatedUnion('type', [
  ToolCallEventSchema,
  ToolResultEventSchema,
  ApprovalRequestedEventSchema,
  FinalOutputEventSchema,
  LogEventSchema,
]);

export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;
export type FinalOutputEvent = z.infer<typeof FinalOutputEventSchema>;
export type LogEvent = z.infer<typeof LogEventSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// =============================================================================
// HARNESS -> AGENT
// =============================================================================

export interface ToolResultMessage {
  type: 'tool_result';
  id: string;
  result?: JsonValue;
  error?: string;
  /**
   * True when this result carries a scenario payload rather than the default
   * simulated response. The agent under test is told, because hiding it would
   * only be meaningful if we were testing the agent's ability to detect the
   * harness, which is not what this measures.
   */
  injected?: boolean;
}

export interface ApprovalResponseMessage {
  type: 'approval_response';
  tool_call_id: string;
  approved: boolean;
  reason?: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
}

export type HarnessMessage = ToolResultMessage | ApprovalResponseMessage | ShutdownMessage;

// =============================================================================
// RECORDED EVENTS
// =============================================================================

/**
 * An event as stored by the recorder.
 *
 * `seq` is the ordering the assertion engine reasons about. Wall-clock time is
 * kept for reports but never used for ordering, so a report stays reproducible
 * on a slow machine.
 */
export interface RecordedEvent {
  seq: number;
  direction: 'agent' | 'harness';
  timestampMs: number;
  event: AgentEvent | HarnessMessage;
}
