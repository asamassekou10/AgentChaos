/**
 * Transport-level coverage.
 *
 * The `splitCommand` tests are security tests, not parsing tests. SECURITY.md
 * promises that a config file cannot introduce a shell, and that promise is
 * only worth making if something checks it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlStdioTransport, splitCommand } from '../src/transport/jsonl-stdio.js';
import type { AgentEvent } from '../src/protocol/events.js';

describe('splitCommand', () => {
  it('splits on whitespace', () => {
    expect(splitCommand('node agent.js --mode safe')).toEqual([
      'node',
      'agent.js',
      '--mode',
      'safe',
    ]);
  });

  it('keeps a double-quoted segment together', () => {
    expect(splitCommand('node "my agent.js"')).toEqual(['node', 'my agent.js']);
  });

  it('keeps a single-quoted segment together', () => {
    expect(splitCommand("node 'my agent.js'")).toEqual(['node', 'my agent.js']);
  });

  it('collapses repeated whitespace and tabs', () => {
    expect(splitCommand('node\t\tagent.js   --flag')).toEqual(['node', 'agent.js', '--flag']);
  });

  it('returns an empty list for an empty command', () => {
    expect(splitCommand('   ')).toEqual([]);
  });

  it('treats shell metacharacters as literal argv, never as syntax', () => {
    // These are passed to the process as arguments. Because spawn is called
    // without a shell, none of them can start a second command.
    expect(splitCommand('node agent.js; rm -rf /')).toEqual([
      'node',
      'agent.js;',
      'rm',
      '-rf',
      '/',
    ]);
    expect(splitCommand('node a.js | tee out')).toEqual(['node', 'a.js', '|', 'tee', 'out']);
    expect(splitCommand('node a.js && curl x')).toEqual(['node', 'a.js', '&&', 'curl', 'x']);
    expect(splitCommand('node a.js > /tmp/out')).toEqual(['node', 'a.js', '>', '/tmp/out']);
    expect(splitCommand('node $(whoami).js')).toEqual(['node', '$(whoami).js']);
    expect(splitCommand('node `whoami`.js')).toEqual(['node', '`whoami`.js']);
  });
});

describe('JsonlStdioTransport', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chaos-transport-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function collect(command: string, timeout = 8000) {
    const events: AgentEvent[] = [];
    const failures: string[] = [];
    let stderr = '';

    const transport = new JsonlStdioTransport(
      { command, transport: 'jsonl-stdio', timeout_ms: timeout, env: {} },
      dir,
    );

    return transport
      .run({
        onEvent: (event) => {
          events.push(event);
        },
        onParseFailure: (failure) => {
          failures.push(failure.reason);
        },
        onStderr: (chunk) => {
          stderr += chunk;
        },
      })
      .then((result) => ({ result, events, failures, stderr }));
  }

  it('does not run the command through a shell', async () => {
    // With a shell, the `;` would start a second command and the marker file
    // would appear. Without one, every token after the script name is inert
    // argv that node hands to the script and the script ignores.
    const marker = path.join(dir, 'shell-ran');
    fs.writeFileSync(
      path.join(dir, 'a.mjs'),
      `process.stdout.write(JSON.stringify({ type: 'final_output', content: 'ran with ' + process.argv.length + ' argv' }) + '\\n');\n`,
    );

    const { result, events } = await collect(
      `node a.mjs ; node -e "require('fs').writeFileSync('${marker}','x')"`,
    );

    expect(fs.existsSync(marker), 'a second command executed, so a shell was involved').toBe(false);

    // The agent still ran, and simply received the metacharacters as arguments.
    expect(result.reason.kind).toBe('final_output');
    const final = events[0];
    if (final?.type === 'final_output') expect(final.content).toMatch(/^ran with \d+ argv$/);
  });

  it('reports an executable that does not exist rather than throwing', async () => {
    const { result } = await collect('definitely-not-a-real-binary-xyz');
    expect(result.reason.kind).toBe('error');
  });

  it('captures stderr without treating it as protocol', async () => {
    fs.writeFileSync(
      path.join(dir, 'a.mjs'),
      `process.stderr.write('a log line\\n');
process.stdout.write('{"type":"final_output","content":"done"}\\n');\n`,
    );

    const { result, events, stderr, failures } = await collect('node a.mjs');

    expect(result.reason.kind).toBe('final_output');
    expect(stderr).toContain('a log line');
    expect(failures).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it('reports an unparsable stdout line instead of dropping it', async () => {
    fs.writeFileSync(
      path.join(dir, 'a.mjs'),
      `process.stdout.write('hello, not json\\n');
process.stdout.write('{"type":"final_output","content":"done"}\\n');\n`,
    );

    const { failures, events } = await collect('node a.mjs');

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/not valid JSON/);
    expect(events).toHaveLength(1);
  });

  it('reassembles events split across write boundaries', async () => {
    fs.writeFileSync(
      path.join(dir, 'a.mjs'),
      `process.stdout.write('{"type":"tool_call","id":"c1","tool":"a","argum');
await new Promise((r) => setTimeout(r, 30));
process.stdout.write('ents":{}}\\n{"type":"final_output","content":"done"}\\n');\n`,
    );

    const { events } = await collect('node a.mjs');

    expect(events.map((e) => e.type)).toEqual(['tool_call', 'final_output']);
  });

  it('stops at the timeout rather than hanging', async () => {
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'setInterval(() => {}, 1000);\n');

    const { result } = await collect('node a.mjs', 900);

    expect(result.reason.kind).toBe('timeout');
  }, 15_000);

  it('resolves cwd relative to the config directory', async () => {
    const nested = path.join(dir, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(
      path.join(nested, 'a.mjs'),
      `process.stdout.write(JSON.stringify({ type: 'final_output', content: process.cwd() }) + '\\n');\n`,
    );

    const transport = new JsonlStdioTransport(
      { command: 'node a.mjs', transport: 'jsonl-stdio', timeout_ms: 8000, env: {}, cwd: 'nested' },
      dir,
    );

    const events: AgentEvent[] = [];
    await transport.run({
      onEvent: (event) => {
        events.push(event);
      },
      onParseFailure: () => {},
      onStderr: () => {},
    });

    const final = events[0];
    expect(final?.type).toBe('final_output');
    if (final?.type === 'final_output') expect(final.content).toContain('nested');
  });

  it('passes configured env to the agent', async () => {
    fs.writeFileSync(
      path.join(dir, 'a.mjs'),
      `process.stdout.write(JSON.stringify({ type: 'final_output', content: process.env.CHAOS_TEST_VALUE ?? 'unset' }) + '\\n');\n`,
    );

    const transport = new JsonlStdioTransport(
      {
        command: 'node a.mjs',
        transport: 'jsonl-stdio',
        timeout_ms: 8000,
        env: { CHAOS_TEST_VALUE: 'from-config' },
      },
      dir,
    );

    const events: AgentEvent[] = [];
    await transport.run({
      onEvent: (event) => {
        events.push(event);
      },
      onParseFailure: () => {},
      onStderr: () => {},
    });

    const final = events[0];
    if (final?.type === 'final_output') expect(final.content).toBe('from-config');
  });
});
