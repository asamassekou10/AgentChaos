/**
 * GitHub Actions output.
 *
 * Two surfaces, because they serve different readers. The job summary is what
 * someone opens after the build went red and wants the whole picture. The
 * workflow annotations are what they see without opening anything, attached to
 * the scenario file that declared the boundary.
 *
 * Neither invents information. Every line here comes from the same ScenarioRun
 * the terminal reporter uses, so a failure reads identically in a terminal, in
 * a job summary, and in a JSON report.
 */

import path from 'node:path';
import { buildEvidence, summarizeValue } from '../evidence/builder.js';
import type { ScenarioRun } from '../engine/runner.js';

/** A GitHub workflow command, one per line, written to stdout. */
export interface Annotation {
  level: 'error' | 'warning' | 'notice';
  title: string;
  message: string;
  file?: string;
  line?: number;
}

/** Escape the characters GitHub treats as structure in a workflow command. */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function formatAnnotation(annotation: Annotation): string {
  const properties: string[] = [`title=${escapeProperty(annotation.title)}`];
  if (annotation.file !== undefined) properties.push(`file=${escapeProperty(annotation.file)}`);
  if (annotation.line !== undefined) properties.push(`line=${annotation.line}`);

  return `::${annotation.level} ${properties.join(',')}::${escapeData(annotation.message)}`;
}

/**
 * One annotation per violation, plus one per inconclusive run.
 *
 * Inconclusive is a warning rather than an error. It did not find a
 * vulnerability, so failing the build on it by default would train people to
 * ignore the red. Whether it fails the build is the workflow's choice, exposed
 * as an action input.
 */
export function buildAnnotations(runs: ScenarioRun[], repoRoot: string): Annotation[] {
  const annotations: Annotation[] = [];

  for (const run of runs) {
    const { scenario, filePath } = run.scenario;
    const relative = path.relative(repoRoot, filePath);
    const file = relative.startsWith('..') ? filePath : relative;

    if (run.inconclusiveReason) {
      annotations.push({
        level: 'warning',
        title: `Inconclusive: ${scenario.name}`,
        message: `${run.inconclusiveReason} This is not a pass.`,
        file,
        line: 1,
      });
      continue;
    }

    for (const violation of run.violations) {
      const evidence = buildEvidence(scenario, violation, run.events, run.injections);
      const steps = evidence.steps.map((step) => `${step.index}. ${step.text}`).join('\n');

      annotations.push({
        level: 'error',
        title: `${scenario.severity.toUpperCase()}: ${scenario.name}`,
        message:
          `${violation.summary}\n\n` +
          `Boundary: ${evidence.expectedBoundary}\n\n` +
          `Evidence:\n${steps}\n\n` +
          `Mitigation: ${evidence.mitigation}`,
        file,
        line: 1,
      });
    }
  }

  return annotations;
}

const STATUS_ICON = { passed: '✅', failed: '❌', inconclusive: '⚠️' } as const;

/**
 * The job summary, as GitHub-flavoured markdown.
 *
 * Failures get their evidence inline. Passes get a row. The point is that
 * someone can decide whether to care without leaving the page, and can see the
 * whole attack path without opening an artifact.
 */
export function renderJobSummary(runs: ScenarioRun[]): string {
  const passed = runs.filter((r) => r.passed).length;
  const failed = runs.filter((r) => !r.passed && !r.inconclusiveReason).length;
  const inconclusive = runs.filter((r) => r.inconclusiveReason).length;

  const lines: string[] = [];
  lines.push('## AgentChaos security test');
  lines.push('');

  if (failed > 0) {
    lines.push(
      `**${failed} security boundary crossed.** An attack scenario succeeded against this agent.`,
    );
  } else if (inconclusive > 0) {
    lines.push(
      `**${inconclusive} scenario(s) inconclusive.** Nothing was proven either way, so this is not a pass.`,
    );
  } else {
    lines.push(`**All ${passed} scenarios passed.** No tested boundary was crossed.`);
  }

  lines.push('');
  lines.push('| | Scenario | Severity | Injected via | Result |');
  lines.push('| --- | --- | --- | --- | --- |');

  for (const run of runs) {
    const { scenario } = run.scenario;
    const status = run.inconclusiveReason ? 'inconclusive' : run.passed ? 'passed' : 'failed';
    lines.push(
      `| ${STATUS_ICON[status]} | ${scenario.name} | ${scenario.severity} | \`${scenario.inject.on_tool}\` | ${status} |`,
    );
  }

  lines.push('');

  for (const run of runs) {
    if (run.passed) continue;
    const { scenario } = run.scenario;

    lines.push(`### ${run.inconclusiveReason ? '⚠️' : '❌'} ${scenario.name}`);
    lines.push('');

    if (run.inconclusiveReason) {
      lines.push(run.inconclusiveReason);
      lines.push('');
      lines.push('_This scenario did not produce a verdict. It is not a pass._');
      lines.push('');
      continue;
    }

    for (const violation of run.violations) {
      const evidence = buildEvidence(scenario, violation, run.events, run.injections);

      lines.push(violation.summary);
      lines.push('');
      lines.push(`**Violated boundary:** ${evidence.expectedBoundary}`);
      lines.push('');
      lines.push('**Evidence**');
      lines.push('');
      for (const step of evidence.steps) lines.push(`${step.index}. ${step.text}`);
      lines.push('');

      if (violation.tool) {
        const args = violation.arguments
          ? ` with \`${summarizeValue(violation.arguments, 80)}\``
          : '';
        lines.push(`**Tool:** \`${violation.tool}\`${args}`);
      }
      lines.push(
        `**Approval observed:** ${
          evidence.approvalObserved === null
            ? 'not applicable'
            : evidence.approvalObserved
              ? 'yes'
              : 'no'
        }`,
      );
      lines.push('');
      lines.push(`**Mitigation:** ${evidence.mitigation}`);
      lines.push('');
    }

    for (const note of run.notEnforced) {
      lines.push(`> ⚠️ ${note}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '<sub>A pass means the scenarios that ran did not produce a violation. ' +
      'It is not proof that the agent is secure.</sub>',
  );
  lines.push('');

  return lines.join('\n');
}
