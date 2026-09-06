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
  it('never performs or implies a real side effect', () => {
    for (const tool of ['filesystem.write', 'email.send', 'github.create_pull_request']) {
      expect(JSON.stringify(defaultResultFor(tool))).toContain('simulated');
    }
  });

  it('returns a plausible shape for an unknown tool rather than an error', () => {
    expect(defaultResultFor('custom.thing')).toMatchObject({ ok: true });
  });
});
