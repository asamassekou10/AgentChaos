/**
 * `agent-chaos list`
 *
 * Shows what would run. Columns are sized to content so the table stays aligned
 * without a table dependency.
 */

import pc from 'picocolors';
import type { LoadedScenario } from '../../scenario/schema.js';

/** The assertion kinds a scenario declares, as a short label. */
export function describeRule(scenario: LoadedScenario['scenario']): string {
  const parts: string[] = [];

  if (scenario.assert.never.length > 0) parts.push('never');
  if (scenario.assert.never_without_approval.length > 0) parts.push('requires approval');
  if (scenario.assert.no_secret_propagation) parts.push('no secret propagation');
  if (scenario.assert.tool_allowlist) parts.push('tool allowlist');

  return parts.length > 0 ? parts.join(', ') : 'none';
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Collapse a YAML folded string to one line for table display. */
function oneLine(text: string, maxLength = 60): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

export function renderScenarioList(scenarios: LoadedScenario[], color = true): string {
  const c = (fn: (t: string) => string, text: string): string => (color ? fn(text) : text);

  const rows = scenarios.map(({ scenario }) => ({
    id: scenario.id,
    severity: scenario.severity,
    injection: scenario.inject.on_tool,
    rule: describeRule(scenario),
    description: oneLine(scenario.description),
  }));

  const headers = {
    id: 'ID',
    severity: 'SEVERITY',
    injection: 'INJECTION POINT',
    rule: 'EXPECTED RULE',
  };

  const widths = {
    id: Math.max(headers.id.length, ...rows.map((r) => r.id.length)),
    severity: Math.max(headers.severity.length, ...rows.map((r) => r.severity.length)),
    injection: Math.max(headers.injection.length, ...rows.map((r) => r.injection.length)),
    rule: Math.max(headers.rule.length, ...rows.map((r) => r.rule.length)),
  };

  const lines: string[] = [''];
  lines.push(
    '  ' +
      c(
        pc.dim,
        [
          pad(headers.id, widths.id),
          pad(headers.severity, widths.severity),
          pad(headers.injection, widths.injection),
          headers.rule,
        ].join('  '),
      ),
  );

  for (const row of rows) {
    lines.push(
      '  ' +
        [
          c(pc.bold, pad(row.id, widths.id)),
          pad(row.severity, widths.severity),
          pad(row.injection, widths.injection),
          pad(row.rule, widths.rule),
        ].join('  '),
    );
    lines.push('    ' + c(pc.dim, row.description));
  }

  lines.push('');
  lines.push(
    `  ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}. Run one with ${c(pc.bold, 'agent-chaos test --scenario <id>')}.`,
  );
  lines.push('');

  return lines.join('\n');
}
