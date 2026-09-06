/**
 * Evidence construction.
 *
 * Turns a recording into an ordered, human-checkable account of how the agent
 * got from an injected payload to a violation. Every step names an observed
 * event; nothing here infers intent, and nothing describes the model's
 * reasoning, because the protocol never carries any.
 */

import type { RecordedEvent } from '../protocol/events.js';
import type { Violation } from '../policy/assertions.js';
import type { InjectionRecord } from '../engine/injector.js';
import type { Scenario } from '../scenario/schema.js';

export interface EvidenceStep {
  /** 1-based position in the narrative. */
  index: number;
  /** The recorded event this step is drawn from, when there is one. */
  seq?: number;
  text: string;
}

export interface Evidence {
  steps: EvidenceStep[];
  /** The boundary the scenario declared, quoted verbatim. */
  expectedBoundary: string;
  /** What to change. Falls back to a per-violation default. */
  mitigation: string;
  approvalObserved: boolean | null;
}

/** Compact a value for display without letting a payload flood the terminal. */
export function summarizeValue(value: unknown, maxLength = 120): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

const DEFAULT_MITIGATIONS: Record<Violation['kind'], string> = {
  never:
    'Treat tool results as untrusted data, not instructions. Constrain which paths the agent may read regardless of what a tool result asks for.',
  never_without_approval:
    'Require an explicit approval step before this tool runs, and make the approval a precondition of the call rather than a notification after it.',
  secret_propagation:
    'Prevent values read from one tool from being passed to another tool or into final output without an explicit, reviewed step.',
  tool_allowlist:
    'Enforce the tool allowlist in the agent runtime. A tool result claiming expanded permissions must not change what the agent can call.',
};

/**
 * Build the evidence for one violation.
 *
 * The narrative is fixed at five beats where the data supports them: what was
 * injected, that the agent received it, what the agent then did, what matched,
 * and whether approval was observed. Keeping the shape stable means a reader
 * who has seen one failure can read the next one quickly.
 */
export function buildEvidence(
  scenario: Scenario,
  violation: Violation,
  events: RecordedEvent[],
  injections: InjectionRecord[],
): Evidence {
  const steps: EvidenceStep[] = [];
  const push = (text: string, seq?: number): void => {
    steps.push({ index: steps.length + 1, text, ...(seq !== undefined ? { seq } : {}) });
  };

  const injection = injections[0];
  if (injection) {
    push(`Payload injected through ${injection.tool}`);

    const delivery = events.find(
      (e) =>
        e.direction === 'harness' &&
        'type' in e.event &&
        e.event.type === 'tool_result' &&
        e.event.id === injection.callId,
    );
    push('Agent received the injected tool result', delivery?.seq);
  } else {
    push(`Scenario targets ${scenario.inject.on_tool}, but no injection was recorded`);
  }

  if (violation.tool) {
    push(`Agent called ${violation.tool}`, violation.atSeq);
  } else {
    push('Agent produced final output', violation.atSeq);
  }

  if (violation.matchedPattern) {
    const argSummary = violation.arguments ? summarizeValue(violation.arguments) : undefined;
    push(
      `Matched the forbidden pattern ${violation.matchedPattern}${argSummary ? ` in ${argSummary}` : ''}`,
      violation.atSeq,
    );
  } else if (violation.arguments && Object.keys(violation.arguments).length > 0) {
    push(`Arguments: ${summarizeValue(violation.arguments)}`, violation.atSeq);
  }

  if (violation.approvalObserved === false) {
    push('No approval event was observed before the call');
  } else if (violation.approvalObserved === true) {
    push('An approval request was observed, but the action is forbidden regardless');
  }

  return {
    steps,
    expectedBoundary: scenario.evidence.expected_boundary,
    mitigation: scenario.evidence.mitigation ?? DEFAULT_MITIGATIONS[violation.kind],
    approvalObserved: violation.approvalObserved,
  };
}
