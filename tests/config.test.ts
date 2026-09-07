import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/load.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chaos-config-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(dir, name), contents, 'utf8');
}

const MINIMAL = `version: 1
agent:
  command: "node agent.js"
`;

describe('loadConfig', () => {
  it('loads a minimal config and applies defaults', () => {
    write('agent-chaos.yaml', MINIMAL);
    const loaded = loadConfig(undefined, dir);

    expect(loaded.config.agent.transport).toBe('jsonl-stdio');
    expect(loaded.config.agent.timeout_ms).toBe(30_000);
    expect(loaded.config.policy.sensitive_paths).toEqual([]);
    expect(loaded.scenarioDir).toBe(path.resolve(dir, './agent-chaos/scenarios'));
  });

  it('resolves the scenario directory relative to the config file, not the cwd', () => {
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(
      path.join(dir, 'nested', 'agent-chaos.yaml'),
      `${MINIMAL}scenarios:\n  directory: "./my-scenarios"\n`,
    );

    const loaded = loadConfig(path.join(dir, 'nested', 'agent-chaos.yaml'), dir);
    expect(loaded.scenarioDir).toBe(path.join(dir, 'nested', 'my-scenarios'));
  });

  it('accepts agent-chaos.yml as well as .yaml', () => {
    write('agent-chaos.yml', MINIMAL);
    expect(() => loadConfig(undefined, dir)).not.toThrow();
  });

  it('explains where it looked when no config exists', () => {
    expect(() => loadConfig(undefined, dir)).toThrow(ConfigError);
    try {
      loadConfig(undefined, dir);
    } catch (error) {
      expect((error as ConfigError).message).toContain('No agent-chaos.yaml found');
      expect((error as ConfigError).detail).toContain('agent-chaos init');
    }
  });

  it('reports a missing explicit config path', () => {
    expect(() => loadConfig('nope.yaml', dir)).toThrow(/Config file not found/);
  });

  it('rejects an unknown top-level key rather than ignoring it', () => {
    write('agent-chaos.yaml', `${MINIMAL}policies:\n  sensitive_paths: []\n`);
    expect(() => loadConfig(undefined, dir)).toThrow(/failed validation/);
  });

  it('rejects a misspelled policy key, which would otherwise silently do nothing', () => {
    write('agent-chaos.yaml', `${MINIMAL}policy:\n  sensitive_path:\n    - ".env"\n`);

    try {
      loadConfig(undefined, dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).detail).toContain('sensitive_path');
    }
  });

  it('rejects a missing version', () => {
    write('agent-chaos.yaml', 'agent:\n  command: "node agent.js"\n');
    expect(() => loadConfig(undefined, dir)).toThrow(/failed validation/);
  });

  it('rejects an empty agent command', () => {
    write('agent-chaos.yaml', 'version: 1\nagent:\n  command: ""\n');
    try {
      loadConfig(undefined, dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).detail).toContain('must not be empty');
    }
  });

  it('rejects an unsupported transport', () => {
    write('agent-chaos.yaml', 'version: 1\nagent:\n  command: "x"\n  transport: "grpc"\n');
    expect(() => loadConfig(undefined, dir)).toThrow(/failed validation/);
  });

  it('reports malformed YAML as a YAML problem, not a schema problem', () => {
    write('agent-chaos.yaml', 'version: 1\nagent:\n  command: "unclosed\n   - [\n');
    expect(() => loadConfig(undefined, dir)).toThrow(/not valid YAML/);
  });

  it('reports an empty file clearly', () => {
    write('agent-chaos.yaml', '\n');
    expect(() => loadConfig(undefined, dir)).toThrow(/empty or not a mapping/);
  });

  it('does not search parent directories for a config', () => {
    write('agent-chaos.yaml', MINIMAL);
    const child = path.join(dir, 'child');
    fs.mkdirSync(child);
    expect(() => loadConfig(undefined, child)).toThrow(/No agent-chaos.yaml found/);
  });
});

describe('client facts', () => {
  it('defaults both lists to empty, so an old config behaves as before', () => {
    write('agent-chaos.yaml', MINIMAL);
    const loaded = loadConfig(undefined, dir);

    expect(loaded.config.client.reachable_tools).toEqual([]);
    expect(loaded.config.client.pre_approved_tools).toEqual([]);
  });

  it('parses declared client facts', () => {
    write(
      'agent-chaos.yaml',
      `${MINIMAL}client:
  reachable_tools: ["github.get_issue", "filesystem.*"]
  pre_approved_tools: ["filesystem.write"]
`,
    );
    const loaded = loadConfig(undefined, dir);

    expect(loaded.config.client.reachable_tools).toEqual(['github.get_issue', 'filesystem.*']);
    expect(loaded.config.client.pre_approved_tools).toEqual(['filesystem.write']);
  });

  it('rejects a misspelled key rather than ignoring it', () => {
    write(
      'agent-chaos.yaml',
      `${MINIMAL}client:
  preapproved_tools: ["filesystem.write"]
`,
    );
    expect(() => loadConfig(undefined, dir)).toThrow(ConfigError);
  });
});
