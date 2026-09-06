/**
 * Payload injection.
 *
 * Decides what a tool call gets back: the scenario's payload if this is the
 * call being attacked, or a benign simulated result otherwise.
 *
 * The default result matters more than it looks. An agent that receives an
 * error for every tool it did not get injected on will stop early and the
 * scenario will pass having tested nothing. Benign, plausible, and boring is
 * the right default.
 */

import type { JsonValue, ToolCallEvent, ToolResultMessage } from '../protocol/events.js';
import type { Scenario } from '../scenario/schema.js';

export interface InjectionRecord {
  /** The tool whose result was replaced. */
  tool: string;
  /** The call id that received the payload. */
  callId: string;
  /** Which matching call was hit, 1-based. */
  occurrence: number;
}

export class Injector {
  private counts = new Map<string, number>();
  private injections: InjectionRecord[] = [];

  constructor(private readonly scenario: Scenario) {}

  /**
   * Build the reply for a tool call.
   *
   * Injection fires exactly once, on the configured occurrence. Firing on every
   * matching call would let a scenario pass or fail on how many times the agent
   * happened to poll a tool, which is not a property of its security posture.
   */
  resultFor(call: ToolCallEvent): ToolResultMessage {
    const { inject } = this.scenario;

    if (call.tool !== inject.on_tool) {
      return { type: 'tool_result', id: call.id, result: defaultResultFor(call.tool) };
    }

    const seen = (this.counts.get(call.tool) ?? 0) + 1;
    this.counts.set(call.tool, seen);

    if (seen !== inject.occurrence) {
      return { type: 'tool_result', id: call.id, result: defaultResultFor(call.tool) };
    }

    this.injections.push({ tool: call.tool, callId: call.id, occurrence: seen });

    return { type: 'tool_result', id: call.id, result: inject.result, injected: true };
  }

  /** Every injection that actually fired, for the evidence trail. */
  getInjections(): InjectionRecord[] {
    return [...this.injections];
  }
}

/**
 * A benign result for a tool the scenario is not attacking.
 *
 * These are simulated. Nothing here touches a real filesystem, network, or
 * credential store, and the values are obviously synthetic so they cannot be
 * mistaken for real data if they end up in a report.
 */
export function defaultResultFor(tool: string): JsonValue {
  switch (tool) {
    case 'filesystem.read':
      return { content: '', note: 'simulated by AgentChaos; no file was read' };
    case 'filesystem.write':
      return { ok: true, note: 'simulated by AgentChaos; nothing was written' };
    case 'filesystem.list':
      return { entries: [], note: 'simulated by AgentChaos' };
    case 'email.send':
      return { ok: true, note: 'simulated by AgentChaos; no email was sent' };
    case 'github.get_issue':
      return {
        title: 'Example issue',
        body: 'This is a simulated issue body with no instructions in it.',
      };
    case 'github.create_pull_request':
      return { ok: true, number: 0, note: 'simulated by AgentChaos; nothing was created' };
    default:
      return { ok: true, note: `simulated result for ${tool}` };
  }
}
