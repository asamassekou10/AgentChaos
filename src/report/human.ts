/**
 * Terminal reporting.
 *
 * Failures get the space; passes get a line. A run where everything passed
 * should be readable in a second, and a run with one failure should put that
 * failure's whole story on screen without scrolling.
 */

import pc from 'picocolors';
import { buildEvidence } from '../evidence/builder.js';
import type { ScenarioRun } from '../engine/runner.js';
import type { Severity } from '../scenario/schema.js';
import type { AgentEvent, RecordedEvent } from '../protocol/events.js';
import { summarizeValue } from '../evidence/builder.js';

const SEVERITY_COLOR: Record<Severity, (text: string) => string> = {
  critical: pc.red,
  high: pc.red,
  medium: pc.yellow,
  low: pc.blue,
};

export interface HumanReportOptions {
  verbose: boolean;
  /** Disable ANSI colour. Respected in addition to picocolors' own detection. */
  color?: boolean;
}

function colorize(enabled: boolean, fn: (text: string) => string, text: string): string {
  return enabled ? fn(text) : text;
}

export function renderHumanReport(runs: ScenarioRun[], options: HumanReportOptions): string {
  const color = options.color !== false;
  const lines: string[] = [];
  const c = (fn: (t: string) => string, text: string): string => colorize(color, fn, text);

  lines.push('');
  lines.push(c(pc.bold, 'AgentChaos Security Test'));
  lines.push('');

  for (const run of runs) {
    lines.push(...renderRun(run, options, color));
  }

  const passed = runs.filter((r) => r.passed).length;
  const failed = runs.filter((r) => !r.passed && !r.inconclusiveReason).length;
  const inconclusive = runs.filter((r) => r.inconclusiveReason).length;

  const parts = [`${passed} passed`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (inconclusive > 0) parts.push(`${inconclusive} inconclusive`);

  const summary = `Summary: ${parts.join(', ')}`;
  lines.push(failed > 0 || inconclusive > 0 ? c(pc.bold, summary) : c(pc.green, summary));
  lines.push('');

  return lines.join('\n');
}

/**
 * One line describing how a repeated scenario behaved across its runs.
 *
 * Only interesting when the outcomes disagreed. A scenario that failed all
 * five times is already described by the verdict above it, and repeating
 * "5 of 5" for every line would bury the one result that varied.
 */
function repeatLine(run: ScenarioRun): string | null {
  const repeat = run.repeat;
  if (!repeat) return null;

  const outcomes = [
    { count: repeat.violated, word: 'failed' },
    { count: repeat.inconclusive, word: 'inconclusive' },
    { count: repeat.passed, word: 'passed' },
  ].filter((o) => o.count > 0);

  if (outcomes.length <= 1) return null;

  const parts = outcomes.map((o) => `${o.word} ${o.count}`);
  return `Across ${repeat.total} runs: ${parts.join(', ')}. Reporting the worst.`;
}

function renderRun(run: ScenarioRun, options: HumanReportOptions, color: boolean): string[] {
  const c = (fn: (t: string) => string, text: string): string => colorize(color, fn, text);
  const { scenario } = run.scenario;
  const lines: string[] = [];
  const repeated = repeatLine(run);

  if (run.inconclusiveReason) {
    lines.push(`${c(pc.yellow, '!')} ${scenario.name}`);
    lines.push(`  ${c(pc.dim, 'Inconclusive')}`);
    if (repeated) lines.push(`  ${c(pc.yellow, repeated)}`);
    lines.push('');
    lines.push(`  ${run.inconclusiveReason}`);
    lines.push('');
    lines.push(`  ${c(pc.dim, 'This scenario did not produce a verdict. It is not a pass.')}`);
    lines.push('');
    if (options.verbose) lines.push(...renderTranscript(run, color));
    return lines;
  }

  if (run.passed) {
    lines.push(`${c(pc.green, '✓')} ${scenario.name}`);
    if (repeated) lines.push(`  ${c(pc.yellow, repeated)}`);
    for (const note of run.notEnforced) {
      lines.push(`  ${c(pc.yellow, 'not enforced:')} ${note}`);
    }
    if (options.verbose) {
      lines.push(`  ${c(pc.dim, `Severity: ${scenario.severity}`)}`);
      lines.push(`  ${c(pc.dim, scenario.evidence.expected_boundary)}`);
      lines.push('');
      lines.push(...renderTranscript(run, color));
    }
    return lines;
  }

  const severityColor = SEVERITY_COLOR[scenario.severity];
  lines.push(`${c(pc.red, '✗')} ${scenario.name}`);
  lines.push(`  Severity: ${c(severityColor, scenario.severity)}`);
  if (repeated) lines.push(`  ${c(pc.yellow, repeated)}`);
  lines.push('');

  for (const violation of run.violations) {
    const evidence = buildEvidence(scenario, violation, run.events, run.injections);

    lines.push(`  ${violation.summary}`);
    lines.push('');
    lines.push(`  ${c(pc.bold, 'Violated boundary:')}`);
    lines.push(`  ${evidence.expectedBoundary}`);
    lines.push('');
    lines.push(`  ${c(pc.bold, 'Evidence:')}`);
    for (const step of evidence.steps) {
      lines.push(`  ${step.index}. ${step.text}`);
    }
    lines.push('');

    if (violation.tool) {
      lines.push(`  ${c(pc.bold, 'Tool:')} ${violation.tool}`);
      if (violation.arguments && Object.keys(violation.arguments).length > 0) {
        lines.push(`  ${c(pc.bold, 'Arguments:')} ${summarizeValue(violation.arguments)}`);
      }
    }
    lines.push(
      `  ${c(pc.bold, 'Approval observed:')} ${
        evidence.approvalObserved === null
          ? 'not applicable'
          : evidence.approvalObserved
            ? 'yes'
            : 'no'
      }`,
    );
    lines.push('');
    lines.push(`  ${c(pc.bold, 'Mitigation:')}`);
    lines.push(`  ${evidence.mitigation}`);
    lines.push('');
  }

  for (const note of run.notEnforced) {
    lines.push(`  ${c(pc.yellow, 'not enforced:')} ${note}`);
    lines.push('');
  }

  if (options.verbose) lines.push(...renderTranscript(run, color));

  return lines;
}

/** The full transcript, shown only with --verbose. */
function renderTranscript(run: ScenarioRun, color: boolean): string[] {
  const c = (fn: (t: string) => string, text: string): string => colorize(color, fn, text);
  const lines: string[] = [`  ${c(pc.bold, 'Transcript:')}`];

  for (const recorded of run.events) {
    lines.push(`  ${c(pc.dim, String(recorded.seq).padStart(3))} ${describeEvent(recorded)}`);
  }

  for (const failure of run.parseFailures) {
    lines.push(
      `      ${c(pc.yellow, 'unparsed:')} ${failure.reason} — ${summarizeValue(failure.line, 80)}`,
    );
  }

  if (run.stderr.trim() !== '') {
    lines.push(`  ${c(pc.bold, 'Agent stderr:')}`);
    for (const line of run.stderr.trimEnd().split('\n')) lines.push(`      ${line}`);
  }

  lines.push('');
  return lines;
}

function describeEvent(recorded: RecordedEvent): string {
  const arrow = recorded.direction === 'agent' ? 'agent →' : '← chaos';
  const event = recorded.event;

  if (!('type' in event)) return `${arrow} (unknown)`;

  switch (event.type) {
    case 'tool_call':
      return `${arrow} tool_call ${event.tool} ${summarizeValue(event.arguments, 80)}`;
    case 'tool_result': {
      const injected = 'injected' in event && event.injected ? ' [injected payload]' : '';
      return `${arrow} tool_result ${event.id}${injected} ${summarizeValue(
        'result' in event ? event.result : undefined,
        80,
      )}`;
    }
    case 'approval_requested':
      return `${arrow} approval_requested ${(event as AgentEvent & { tool: string }).tool}`;
    case 'approval_response':
      return `${arrow} approval_response ${event.approved ? 'granted' : 'denied'}`;
    case 'final_output':
      return `${arrow} final_output ${summarizeValue(event.content, 80)}`;
    case 'log':
      return `${arrow} log ${summarizeValue(event.message, 80)}`;
    case 'shutdown':
      return `${arrow} shutdown`;
    default:
      return `${arrow} (unrecognised)`;
  }
}
