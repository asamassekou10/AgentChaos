/**
 * Scenario execution.
 *
 * Wires a transport, a recorder, and an injector together, runs one scenario,
 * and hands the recording to the assertion engine. Deliberately knows nothing
 * about JSONL or child processes: swap the transport and this is unchanged.
 */

import type { LoadedConfig } from '../config/schema.js';
import { evaluate, type Violation } from '../policy/assertions.js';
import type { AgentEvent, RecordedEvent } from '../protocol/events.js';
import type { LoadedScenario } from '../scenario/schema.js';
import { JsonlStdioTransport } from '../transport/jsonl-stdio.js';
import type { Transport, TransportExitReason } from '../transport/types.js';
import { Injector, type InjectionRecord } from './injector.js';
import { Recorder } from './recorder.js';

export interface ScenarioRun {
  scenario: LoadedScenario;
  passed: boolean;
  violations: Violation[];
  notEnforced: string[];
  injections: InjectionRecord[];
  events: RecordedEvent[];
  exitReason: TransportExitReason;
  parseFailures: { line: string; reason: string }[];
  stderr: string;
  durationMs: number;
  /**
   * Set when the run could not be judged: the agent crashed, timed out, or
   * never produced anything. Reported as an error rather than a pass, because
   * "we could not test it" and "it is safe" are different answers.
   */
  inconclusiveReason?: string;
}

/** Build the transport named by the config. */
export function createTransport(loaded: LoadedConfig): Transport {
  switch (loaded.config.agent.transport) {
    case 'jsonl-stdio':
      return new JsonlStdioTransport(loaded.config.agent, loaded.rootDir);
    default:
      // The schema is a literal union, so this is unreachable today. It stays
      // as the place a future transport gets wired in.
      throw new Error(`Unsupported transport: ${String(loaded.config.agent.transport)}`);
  }
}

export async function runScenario(
  loaded: LoadedConfig,
  scenarioFile: LoadedScenario,
  options: { transport?: Transport; now?: () => number } = {},
): Promise<ScenarioRun> {
  const scenario = scenarioFile.scenario;
  const recorder = new Recorder(options.now);
  const injector = new Injector(scenario);
  const transport = options.transport ?? createTransport(loaded);

  const startedAt = Date.now();

  const result = await transport.run({
    onEvent: (event: AgentEvent) => {
      recorder.recordAgentEvent(event);

      // A tool call is the only event the harness answers. Approval requests
      // are recorded but not granted: this MVP tests whether an agent asks,
      // not how it behaves once told yes, and auto-approving would quietly
      // remove the very control the scenario is checking for.
      if (event.type === 'tool_call') {
        const reply = injector.resultFor(event);
        recorder.recordHarnessMessage(reply);
        transport.send(reply);
      }
    },
    onParseFailure: (failure) => recorder.recordParseFailure(failure),
    onStderr: (chunk) => recorder.recordStderr(chunk),
  });

  const events = recorder.getEvents();
  const evaluation = evaluate(scenario, events, loaded.config.policy, loaded.config.client);
  const inconclusive =
    describeInconclusive(result.reason, events, injector.getInjections().length) ??
    evaluation.inconclusiveNotes[0];

  return {
    scenario: scenarioFile,
    // An inconclusive run is not a pass. Reporting one as passing is how a
    // security tool ends up providing false assurance.
    passed: inconclusive === undefined && evaluation.passed,
    violations: evaluation.violations,
    notEnforced: evaluation.notEnforced,
    injections: injector.getInjections(),
    events,
    exitReason: result.reason,
    parseFailures: recorder.getParseFailures(),
    stderr: recorder.getStderr(),
    durationMs: Date.now() - startedAt,
    ...(inconclusive !== undefined ? { inconclusiveReason: inconclusive } : {}),
  };
}

/**
 * Decide whether a run produced a judgeable recording.
 *
 * The bar is deliberately low but non-zero: the payload has to have actually
 * reached the agent. A scenario whose injection never fired tested nothing, and
 * saying so is more useful than a green check.
 */
function describeInconclusive(
  reason: TransportExitReason,
  events: RecordedEvent[],
  injectionCount: number,
): string | undefined {
  if (reason.kind === 'error') {
    return `The agent process could not be run: ${reason.message}`;
  }

  if (reason.kind === 'timeout') {
    return `The agent did not produce a final_output within ${reason.afterMs}ms.`;
  }

  if (events.length === 0) {
    return 'The agent produced no protocol events. Check that it writes JSONL to stdout.';
  }

  if (reason.kind === 'exited' && reason.code !== 0 && reason.code !== null) {
    const sawFinal = events.some(
      (e) => e.direction === 'agent' && (e.event as AgentEvent).type === 'final_output',
    );
    if (!sawFinal)
      return `The agent exited with code ${reason.code} before producing a final_output.`;
  }

  if (injectionCount === 0) {
    return 'The scenario payload was never delivered: the agent did not call the injection tool.';
  }

  return undefined;
}
