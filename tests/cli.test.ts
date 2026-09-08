/**
 * CLI-level coverage: exit codes and file-writing behaviour as a user
 * experiences them, by running the built binary in a child process.
 *
 * These depend on `dist`, so the suite builds once before running.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(repoRoot, 'dist', 'cli', 'index.js');

let dir: string;

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chaos-cli-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[], cwd = dir) {
  return spawnSync('node', [cli, ...args, '--no-color'], { cwd, encoding: 'utf8' });
}

describe('installed entry point', () => {
  // npm installs `bin` as a symlink in node_modules/.bin, so an installed user
  // always reaches the CLI through a link rather than the real path. The
  // entry-point guard compared those two paths unresolved, which was false for
  // every installed user: the CLI exited 0 and printed nothing. It worked
  // perfectly from a checkout, so only running it through a link catches it.
  it('runs when invoked through a symlink, the way npm installs it', () => {
    const link = path.join(dir, 'agent-chaos-link');
    fs.symlinkSync(cli, link);

    const result = spawnSync('node', [link, '--version'], { cwd: dir, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runs a real command through the symlink, not just --version', () => {
    const link = path.join(dir, 'agent-chaos-link');
    fs.symlinkSync(cli, link);

    const result = spawnSync('node', [link, 'init', '--no-color'], { cwd: dir, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'agent-chaos.yaml'))).toBe(true);
  });
});

describe('agent-chaos init', () => {
  it('creates the config and the built-in scenarios', () => {
    const result = runCli(['init']);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'agent-chaos.yaml'))).toBe(true);
    // Derived from the shipped corpus rather than pinned, so adding a scenario
    // does not require editing an unrelated assertion — the same drift the
    // README count below is protected against.
    const shipped = fs.readdirSync(path.join(repoRoot, 'agent-chaos', 'scenarios'));
    expect(fs.readdirSync(path.join(dir, 'agent-chaos', 'scenarios'))).toHaveLength(shipped.length);
  });

  it('does not overwrite an existing file', () => {
    fs.writeFileSync(path.join(dir, 'agent-chaos.yaml'), 'mine\n', 'utf8');
    const result = runCli(['init']);

    expect(result.stdout).toContain('exists');
    expect(fs.readFileSync(path.join(dir, 'agent-chaos.yaml'), 'utf8')).toBe('mine\n');
  });

  it('overwrites with --force', () => {
    fs.writeFileSync(path.join(dir, 'agent-chaos.yaml'), 'mine\n', 'utf8');
    runCli(['init', '--force']);

    expect(fs.readFileSync(path.join(dir, 'agent-chaos.yaml'), 'utf8')).not.toBe('mine\n');
  });

  it('writes scenarios identical to the ones the project ships', () => {
    runCli(['init']);

    const written = fs.readFileSync(
      path.join(dir, 'agent-chaos', 'scenarios', 'prompt-injection.yaml'),
      'utf8',
    );
    const shipped = fs.readFileSync(
      path.join(repoRoot, 'agent-chaos', 'scenarios', 'prompt-injection.yaml'),
      'utf8',
    );

    expect(written).toBe(shipped);
  });
});

describe('agent-chaos list', () => {
  it('shows id, severity, injection point, and expected rule', () => {
    runCli(['init']);
    const result = runCli(['list']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SEVERITY');
    expect(result.stdout).toContain('INJECTION POINT');
    expect(result.stdout).toContain('EXPECTED RULE');
    expect(result.stdout).toContain('prompt-injection-sensitive-file');
    expect(result.stdout).toContain('github.get_issue');
  });

  it('exits 2 with no config', () => {
    const result = runCli(['list']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No agent-chaos.yaml found');
  });
});

describe('agent-chaos test exit codes', () => {
  // Derived, not pinned: the demo agent is built to reach every built-in
  // scenario, so adding one to the corpus should not require editing a count
  // in an unrelated assertion.
  const builtinCount = fs.readdirSync(path.join(repoRoot, 'agent-chaos', 'scenarios')).length;

  it('exits 1 against the vulnerable demo agent', () => {
    const result = spawnSync(
      'node',
      [cli, 'test', '--config', 'examples/demo-agent/vulnerable.yaml', '--no-color'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${builtinCount} failed`);
  });

  it('exits 0 against the safe demo agent', () => {
    const result = spawnSync(
      'node',
      [cli, 'test', '--config', 'examples/demo-agent/safe.yaml', '--no-color'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${builtinCount} passed`);
  });

  it('exits 2 for a missing config', () => {
    const result = runCli(['test']);
    expect(result.status).toBe(2);
  });

  it('exits 2 for an unknown scenario id, and lists the real ones', () => {
    const result = spawnSync(
      'node',
      [
        cli,
        'test',
        '--config',
        'examples/demo-agent/safe.yaml',
        '--scenario',
        'nope',
        '--no-color',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('secret-exfiltration');
  });

  it('runs a single scenario with --scenario', () => {
    const result = spawnSync(
      'node',
      [
        cli,
        'test',
        '--config',
        'examples/demo-agent/safe.yaml',
        '--scenario',
        'secret-exfiltration',
        '--no-color',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 passed');
  });

  it('writes a JSON report with --json', () => {
    const target = path.join(dir, 'nested', 'report.json');
    const result = spawnSync(
      'node',
      [cli, 'test', '--config', 'examples/demo-agent/safe.yaml', '--json', target, '--no-color'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(target, 'utf8')) as { summary: { passed: number } };
    expect(report.summary.passed).toBe(builtinCount);
  });

  it('shows the transcript with --verbose', () => {
    const result = spawnSync(
      'node',
      [
        cli,
        'test',
        '--config',
        'examples/demo-agent/safe.yaml',
        '--scenario',
        'secret-exfiltration',
        '--verbose',
        '--no-color',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.stdout).toContain('Transcript:');
    expect(result.stdout).toContain('[injected payload]');
  });
});
