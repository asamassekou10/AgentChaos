/**
 * The JSON report.
 *
 * The schema is a contract: CI jobs and dashboards read it, so field names and
 * shapes are additive-only across minor versions. `reportVersion` moves when
 * that promise is broken.
 *
 * Two deliberate omissions. Wall-clock timestamps and durations are excluded
 * from the default report because they make two runs of the same deterministic
 * agent produce different bytes, which defeats diffing a report in CI. And the
 * transcript is included only on request, because it contains the injected
 * payload and there is no reason to write attack strings into every artifact.
 */

import type { ScenarioRun } from '../engine/runner.js';
import { buildEvidence } from '../evidence/builder.js';
import type { RecordedEvent } from '../protocol/events.js';

export const REPORT_VERSION = 1;

export interface JsonViolation {
  kind: string;
  summary: string;
  atSeq: number;
  tool?: string;
  arguments?: Record<string, unknown>;
  matchedPattern?: string;
  approvalObserved: boolean | null;
  violatedBoundary: string;
  mitigation: string;
  evidence: { index: number; seq?: number; text: string }[];
}

export interface JsonScenarioResult {
  id: string;
  name: string;
  description: string;
  severity: string;
  status: 'passed' | 'failed' | 'inconclusive';
  injectedVia: string;
  injectionDelivered: boolean;
  violations: JsonViolation[];
  notEnforced: string[];
  inconclusiveReason?: string;
  transcript?: RecordedEvent[];
}

export interface JsonReport {
  reportVersion: number;
  tool: { name: string; version: string };
  summary: {
    total: number;
    passed: number;
    failed: number;
    inconclusive: number;
  };
  scenarios: JsonScenarioResult[];
}

export interface JsonReportOptions {
  toolVersion: string;
  /** Include the full event transcript per scenario. Off by default. */
  includeTranscript?: boolean;
}

export function buildJsonReport(runs: ScenarioRun[], options: JsonReportOptions): JsonReport {
  const scenarios = runs.map((run): JsonScenarioResult => {
    const { scenario } = run.scenario;
    const status: JsonScenarioResult['status'] = run.inconclusiveReason
      ? 'inconclusive'
      : run.passed
        ? 'passed'
        : 'failed';

    const violations = run.violations.map((violation): JsonViolation => {
      const evidence = buildEvidence(scenario, violation, run.events, run.injections);
      return {
        kind: violation.kind,
        summary: violation.summary,
        atSeq: violation.atSeq,
        ...(violation.tool !== undefined ? { tool: violation.tool } : {}),
        ...(violation.arguments !== undefined ? { arguments: violation.arguments } : {}),
        ...(violation.matchedPattern !== undefined
          ? { matchedPattern: violation.matchedPattern }
          : {}),
        approvalObserved: violation.approvalObserved,
        violatedBoundary: evidence.expectedBoundary,
        mitigation: evidence.mitigation,
        evidence: evidence.steps,
      };
    });

    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      severity: scenario.severity,
      status,
      injectedVia: scenario.inject.on_tool,
      injectionDelivered: run.injections.length > 0,
      violations,
      notEnforced: run.notEnforced,
      ...(run.inconclusiveReason !== undefined
        ? { inconclusiveReason: run.inconclusiveReason }
        : {}),
      ...(options.includeTranscript ? { transcript: run.events } : {}),
    };
  });

  return {
    reportVersion: REPORT_VERSION,
    tool: { name: 'agent-chaos', version: options.toolVersion },
    summary: {
      total: scenarios.length,
      passed: scenarios.filter((s) => s.status === 'passed').length,
      failed: scenarios.filter((s) => s.status === 'failed').length,
      inconclusive: scenarios.filter((s) => s.status === 'inconclusive').length,
    },
    scenarios,
  };
}

export function serializeJsonReport(report: JsonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
