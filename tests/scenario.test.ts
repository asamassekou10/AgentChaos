import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadScenarios, selectScenario } from '../src/scenario/load.js';
import type { ConfigError } from '../src/config/load.js';
import { builtinScenarioDir } from '../src/cli/scenarios-source.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chaos-scenario-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(dir, name), contents, 'utf8');
}

const VALID = `version: 1
id: example-scenario
name: Example
description: An example scenario.
severity: high
inject:
  on_tool: github.get_issue
  result:
    body: "hello"
assert:
  never:
    - event: tool_call
      tool: filesystem.read
evidence:
  source: github.get_issue
  expected_boundary: Untrusted content must not cause a read.
`;

describe('loadScenarios', () => {
  it('loads a valid scenario and applies assertion defaults', () => {
    write('a.yaml', VALID);
    const [loaded] = loadScenarios(dir);

    expect(loaded?.scenario.id).toBe('example-scenario');
    expect(loaded?.scenario.assert.tool_allowlist).toBe(false);
    expect(loaded?.scenario.assert.never_without_approval).toEqual([]);
    expect(loaded?.scenario.inject.occurrence).toBe(1);
  });

  it('returns scenarios sorted by id so reports are byte-stable', () => {
    write('z.yaml', VALID.replace('example-scenario', 'zebra'));
    write('a.yaml', VALID.replace('example-scenario', 'alpha'));
    write('m.yaml', VALID.replace('example-scenario', 'middle'));

    expect(loadScenarios(dir).map((s) => s.scenario.id)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('ignores files that are not YAML', () => {
    write('a.yaml', VALID);
    write('notes.md', '# not a scenario');
    expect(loadScenarios(dir)).toHaveLength(1);
  });

  it('rejects a duplicate id, since ids select scenarios on the command line', () => {
    write('a.yaml', VALID);
    write('b.yaml', VALID);
    expect(() => loadScenarios(dir)).toThrow(/Duplicate scenario id/);
  });

  it('rejects an id that is not kebab-case', () => {
    write('a.yaml', VALID.replace('example-scenario', 'Example_Scenario'));

    try {
      loadScenarios(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).detail).toContain('kebab-case');
    }
  });

  it('rejects an unknown assertion key rather than ignoring it', () => {
    write('a.yaml', `${VALID}  always:\n    - event: tool_call\n`);
    expect(() => loadScenarios(dir)).toThrow(/failed validation/);
  });

  it('requires a tool on a `never` matcher, so it cannot silently forbid everything', () => {
    const bare = VALID.replace('      tool: filesystem.read\n', '');
    write('a.yaml', bare);

    try {
      loadScenarios(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).detail).toContain('needs either `tool`');
    }
  });

  it('allows a bare matcher under never_without_approval, which defers to policy', () => {
    write(
      'a.yaml',
      `${VALID.replace(/assert:[\s\S]*?evidence:/, 'assert:\n  never_without_approval:\n    - event: tool_call\nevidence:')}`,
    );
    expect(() => loadScenarios(dir)).not.toThrow();
  });

  it('requires an expected_boundary, because a failure must name what was crossed', () => {
    write('a.yaml', VALID.replace(/ {2}expected_boundary: .*\n/, ''));
    expect(() => loadScenarios(dir)).toThrow(/failed validation/);
  });

  it('explains a missing directory', () => {
    expect(() => loadScenarios(path.join(dir, 'nope'))).toThrow(/Scenario directory not found/);
  });

  it('explains an empty directory', () => {
    expect(() => loadScenarios(dir)).toThrow(/No scenario files/);
  });
});

describe('selectScenario', () => {
  it('narrows to one scenario', () => {
    write('a.yaml', VALID);
    const all = loadScenarios(dir);
    expect(selectScenario(all, 'example-scenario')).toHaveLength(1);
  });

  it('lists the real ids when the requested one does not exist', () => {
    write('a.yaml', VALID);
    const all = loadScenarios(dir);

    try {
      selectScenario(all, 'typo');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).detail).toContain('example-scenario');
    }
  });
});

describe('built-in scenarios', () => {
  it('all validate', () => {
    const scenarios = loadScenarios(builtinScenarioDir());
    expect(scenarios.length).toBeGreaterThanOrEqual(4);
  });

  it('cover the four MVP attack classes', () => {
    const ids = loadScenarios(builtinScenarioDir()).map((s) => s.scenario.id);
    expect(ids).toContain('prompt-injection-sensitive-file');
    expect(ids).toContain('unauthorized-write');
    expect(ids).toContain('secret-exfiltration');
    expect(ids).toContain('tool-permission-escalation');
  });

  it('covers the attack classes added to the corpus', () => {
    const ids = loadScenarios(builtinScenarioDir()).map((s) => s.scenario.id);
    expect(ids).toContain('hidden-unicode-instruction');
    expect(ids).toContain('approval-coercion');
    expect(ids).toContain('ssrf-internal-endpoint');
    expect(ids).toContain('nested-content-injection');
    expect(ids).toContain('destructive-command');
  });

  it('every scenario declares a boundary and at least one assertion', () => {
    for (const { scenario } of loadScenarios(builtinScenarioDir())) {
      expect(scenario.evidence.expected_boundary.trim().length).toBeGreaterThan(0);

      const hasAssertion =
        scenario.assert.never.length > 0 ||
        scenario.assert.never_without_approval.length > 0 ||
        scenario.assert.no_secret_propagation !== undefined ||
        scenario.assert.tool_allowlist;

      expect(hasAssertion, `${scenario.id} asserts nothing`).toBe(true);
    }
  });
});
