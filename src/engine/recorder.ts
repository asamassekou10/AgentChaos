/**
 * The event recorder.
 *
 * Holds the ordered transcript a scenario is judged against. Sequence numbers
 * come from here rather than from timestamps so two runs of the same
 * deterministic agent produce identical recordings, which is what makes JSON
 * reports diffable in CI.
 */

import type { AgentEvent, HarnessMessage, RecordedEvent } from '../protocol/events.js';
import type { ParseFailure } from '../protocol/parse.js';

export class Recorder {
  private readonly events: RecordedEvent[] = [];
  private readonly failures: ParseFailure[] = [];
  private seq = 0;
  private stderr = '';

  constructor(private readonly now: () => number = () => Date.now()) {}

  recordAgentEvent(event: AgentEvent): RecordedEvent {
    const recorded: RecordedEvent = {
      seq: this.seq++,
      direction: 'agent',
      timestampMs: this.now(),
      event,
    };
    this.events.push(recorded);
    return recorded;
  }

  recordHarnessMessage(message: HarnessMessage): RecordedEvent {
    const recorded: RecordedEvent = {
      seq: this.seq++,
      direction: 'harness',
      timestampMs: this.now(),
      event: message,
    };
    this.events.push(recorded);
    return recorded;
  }

  recordParseFailure(failure: ParseFailure): void {
    this.failures.push(failure);
  }

  recordStderr(chunk: string): void {
    this.stderr += chunk;
  }

  getEvents(): RecordedEvent[] {
    return [...this.events];
  }

  getParseFailures(): ParseFailure[] {
    return [...this.failures];
  }

  getStderr(): string {
    return this.stderr;
  }
}
