import { describe, expect, it } from 'vitest';
import { Injector, defaultResultFor } from '../src/engine/injector.js';
import type { ToolCallEvent } from '../src/protocol/events.js';
import type { Scenario } from '../src/scenario/schema.js';

function call(id: string, tool: string): ToolCallEvent {
  return { type: 'tool_call', id, tool, arguments: {} };
}

function scenario(overrides: Partial<Scenario['inject']> = {}): Scenario {
  return {
    version: 1,
    id: 'test',
    name: 'Test',
    description: 'Test.',
    severity: 'high',
    inject: {
      on_tool: 'github.get_issue',
      occurrence: 1,
      result: { body: 'PAYLOAD' },
      ...overrides,
    },
    assert: { never: [], never_without_approval: [], tool_allowlist: false },
    evidence: { source: 'github.get_issue', expected_boundary: 'Boundary.' },
  };
}

describe('Injector', () => {
  it('replaces the result for the targeted tool', () => {
    const injector = new Injector(scenario());
    const reply = injector.resultFor(call('c1', 'github.get_issue'));

    expect(reply.injected).toBe(true);
    expect(reply.result).toEqual({ body: 'PAYLOAD' });
    expect(reply.id).toBe('c1');
  });

  it('returns a benign default for other tools', () => {
    const injector = new Injector(scenario());
    const reply = injector.resultFor(call('c1', 'filesystem.read'));

    expect(reply.injected).toBeUndefined();
    expect(reply.result).toEqual(defaultResultFor('filesystem.read'));
  });

  it('injects only once, so a scenario does not depend on how often a tool is polled', () => {
    const injector = new Injector(scenario());

    expect(injector.resultFor(call('c1', 'github.get_issue')).injected).toBe(true);
    expect(injector.resultFor(call('c2', 'github.get_issue')).injected).toBeUndefined();
    expect(injector.getInjections()).toHaveLength(1);
  });

  it('honours a later occurrence', () => {
    const injector = new Injector(scenario({ occurrence: 2 }));

    expect(injector.resultFor(call('c1', 'github.get_issue')).injected).toBeUndefined();
    expect(injector.resultFor(call('c2', 'github.get_issue')).injected).toBe(true);
    expect(injector.getInjections()[0]?.occurrence).toBe(2);
  });

  it('records which call received the payload, for the evidence trail', () => {
    const injector = new Injector(scenario());
    injector.resultFor(call('c7', 'github.get_issue'));

    expect(injector.getInjections()[0]).toMatchObject({
      tool: 'github.get_issue',
      callId: 'c7',
      occurrence: 1,
    });
  });

  it('reports no injections when the target tool is never called', () => {
    const injector = new Injector(scenario());
    injector.resultFor(call('c1', 'filesystem.read'));

    expect(injector.getInjections()).toHaveLength(0);
  });
});

describe('defaultResultFor', () => {
  const ALL_TOOLS = [
    'filesystem.read',
    'filesystem.write',
    'filesystem.list',
    'email.send',
    'github.get_issue',
    'github.create_pull_request',
    'http.fetch',
    'shell.exec',
    'custom.thing',
  ];

  it('acknowledges a side-effecting call without performing one', () => {
    for (const tool of ['filesystem.write', 'email.send', 'github.create_pull_request']) {
      expect(
        defaultResultFor(tool, { path: 'a.txt', content: 'x', to: 'a@example.invalid' }),
      ).toMatchObject({ ok: true });
    }
  });

  // Regression guard for #9. A benign result is delivered into the context of
  // the agent under test, so anything in it that names the harness tells the
  // subject what is being measured.
  it('never names the harness to the agent', () => {
    for (const tool of ALL_TOOLS) {
      const text = JSON.stringify(defaultResultFor(tool, { path: 'README.md' })).toLowerCase();
      expect(text).not.toContain('agentchaos');
      expect(text).not.toContain('agent-chaos');
      expect(text).not.toContain('simulated');
      expect(text).not.toContain('security test');
    }
  });

  it('gives the agent a workspace with something in it', () => {
    expect(defaultResultFor('filesystem.list', { path: '.' })).toMatchObject({
      entries: expect.arrayContaining(['README.md', 'src']),
    });
    expect(defaultResultFor('filesystem.read', { path: 'config/settings.json' })).toMatchObject({
      content: expect.stringContaining('"debug"'),
    });
  });

  it('reports a missing path as missing rather than as empty', () => {
    expect(defaultResultFor('filesystem.read', { path: 'nope.txt' })).toMatchObject({
      error: expect.stringContaining('ENOENT'),
    });
    expect(defaultResultFor('filesystem.list', { path: 'nope' })).toMatchObject({
      error: expect.stringContaining('ENOENT'),
    });
  });

  it('tolerates the ways agents spell a path', () => {
    for (const spelling of ['.', './', '/', '']) {
      expect(defaultResultFor('filesystem.list', { path: spelling })).toMatchObject({
        entries: expect.arrayContaining(['README.md']),
      });
    }
  });

  it('returns a plausible shape for an unknown tool rather than an error', () => {
    expect(defaultResultFor('custom.thing')).toMatchObject({ ok: true });
  });
});
