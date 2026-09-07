/**
 * `agent-chaos report`
 *
 * Evaluates session recordings produced by `agent-chaos serve`.
 *
 * The whole point of this command is that it shares the engine. It builds the
 * same ScenarioRun shape the JSONL runner produces and hands it to the same
 * evaluator, reporters, and exit-code logic. A finding from an MCP session and
 * a finding from a JSONL run are the same object, reached the same way.
 */

import fs from 'node:fs';
import type { LoadedConfig } from '../../config/schema.js';
import type { ScenarioRun } from '../../engine/runner.js';
import { readSession, sessionPath } from '../../engine/session.js';
import { evaluate } from '../../policy/assertions.js';
import type { LoadedScenario } from '../../scenario/schema.js';
import type { AgentEvent, RecordedEvent } from '../../protocol/events.js';

/**
 * Turn a recording into the run shape the reporters already understand.
 *
 * `null` means there is no recording for this scenario at all, which the caller
 * surfaces rather than treating as an empty pass.
 */
export function runFromSession(
  loaded: LoadedConfig,
  scenarioFile: LoadedScenario,
  explicitPath?: string,
): ScenarioRun | null {
  const scenario = scenarioFile.scenario;
  const file = explicitPath ?? sessionPath(loaded.rootDir, scenario.id);

  if (!fs.existsSync(file)) return null;

  const recording = readSession(file);
  if (!recording) return null;

  const events = recording.events;
  const evaluation = evaluate(scenario, events, loaded.config.policy, loaded.config.client);

  const injections = countInjections(events, scenario.inject.on_tool);
  const inconclusive =
    describeInconclusive(events, injections, recording.unknownTools) ??
    evaluation.inconclusiveNotes[0];

  return {
    scenario: scenarioFile,
    passed: inconclusive === undefined && evaluation.passed,
    violations: evaluation.violations,
    notEnforced: [
      ...evaluation.notEnforced,
      ...partialVisibilityNotes(recording.unknownTools),
      ...simulatedCallNotes(recording.simulatedCalls),
    ],
    injections: injections.map((callId, index) => ({
      tool: scenario.inject.on_tool,
      callId,
      occurrence: index + 1,
    })),
    events,
    exitReason: { kind: 'final_output' },
    parseFailures: [],
    stderr: '',
    durationMs: 0,
    ...(inconclusive !== undefined ? { inconclusiveReason: inconclusive } : {}),
  };
}

/** Call ids that received the scenario payload, read back from the recording. */
function countInjections(events: RecordedEvent[], onTool: string): string[] {
  const ids: string[] = [];

  for (const recorded of events) {
    if (recorded.direction !== 'harness') continue;
    const message = recorded.event;
    if (!('type' in message) || message.type !== 'tool_result') continue;
    if (!('injected' in message) || !message.injected) continue;
    ids.push(message.id);
  }

  // The tool name is carried by the paired call rather than the result, so an
  // empty list here means nothing was injected regardless of which tool ran.
  return ids.length > 0 ? ids : findInjectedByTool(events, onTool);
}

function findInjectedByTool(events: RecordedEvent[], onTool: string): string[] {
  const ids: string[] = [];
  for (const recorded of events) {
    if (recorded.direction !== 'agent') continue;
    const event = recorded.event as AgentEvent;
    if (event.type === 'tool_call' && event.tool === onTool) ids.push(event.id);
  }
  return ids;
}

/**
 * Report tools AgentChaos could not see.
 *
 * An MCP server observes only its own tools. If the agent called something
 * else, this recording is a partial view of what the agent did and any pass
 * drawn from it is unsupported. Saying so is the same discipline as refusing to
 * pass an unenforceable assertion.
 */
function partialVisibilityNotes(unknownTools: string[]): string[] {
  if (unknownTools.length === 0) return [];

  const unique = [...new Set(unknownTools)].sort();
  return [
    `The agent called ${unique.length} tool(s) this server does not provide (${unique.join(', ')}). ` +
      'Those calls were not observed, so this run is a partial view of what the agent did.',
  ];
}

/**
 * Report calls the proxy refused to forward.
 *
 * This is not a caveat, it is a finding. The agent attempted an action the
 * project marks as needing a human, and the only reason nothing happened is
 * that AgentChaos intercepted it. Whether that also violates an assertion is a
 * separate question the engine answers; either way the reader should know the
 * attempt was made against a real toolchain.
 */
function simulatedCallNotes(simulatedCalls: string[]): string[] {
  if (simulatedCalls.length === 0) return [];

  const unique = [...new Set(simulatedCalls)].sort();
  return [
    `AgentChaos intercepted ${simulatedCalls.length} call(s) to ${unique.join(', ')} rather than ` +
      'forwarding them upstream, because the policy marks those tools as requiring approval. ' +
      'The agent attempted them; nothing was actually performed.',
  ];
}

function describeInconclusive(
  events: RecordedEvent[],
  injections: string[],
  unknownTools: string[],
): string | undefined {
  if (events.length === 0) {
    return (
      'The session recording is empty: the agent never called a tool on this server. ' +
      'Check that the MCP server is configured and that the agent actually used it.'
    );
  }

  if (injections.length === 0) {
    return 'The scenario payload was never delivered: the agent did not call the injection tool.';
  }

  if (unknownTools.length > 0) {
    // Not a failure, but not a clean verdict either. The scenario may well have
    // been violated through a tool this server never saw.
    const unique = [...new Set(unknownTools)].sort();
    return (
      `The agent used tools outside this server (${unique.join(', ')}), so its behaviour was ` +
      'only partly observed. Point the agent at AgentChaos alone to get a complete verdict.'
    );
  }

  return undefined;
}
