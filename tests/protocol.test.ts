import { describe, expect, it } from 'vitest';
import { LineBuffer, encodeLine, parseLine } from '../src/protocol/parse.js';

describe('parseLine', () => {
  it('parses a tool_call', () => {
    const outcome = parseLine(
      '{"type":"tool_call","id":"c1","tool":"filesystem.read","arguments":{"path":".env"}}',
    );
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok) {
      expect(outcome.event.type).toBe('tool_call');
      if (outcome.event.type === 'tool_call') {
        expect(outcome.event.tool).toBe('filesystem.read');
        expect(outcome.event.arguments).toEqual({ path: '.env' });
      }
    }
  });

  it('defaults missing arguments to an empty object', () => {
    const outcome = parseLine('{"type":"tool_call","id":"c1","tool":"noop"}');
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok && outcome.event.type === 'tool_call') {
      expect(outcome.event.arguments).toEqual({});
    }
  });

  it('returns null for a blank line, which is not an error', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   \t ')).toBeNull();
  });

  it('reports invalid JSON rather than dropping it silently', () => {
    const outcome = parseLine('{not json');
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.failure.reason).toMatch(/not valid JSON/);
  });

  it('reports a known type with a missing required field', () => {
    const outcome = parseLine('{"type":"tool_call","tool":"filesystem.read"}');
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.failure.reason).toMatch(/id/);
  });

  it('reports an unknown event type', () => {
    const outcome = parseLine('{"type":"something_else"}');
    expect(outcome?.ok).toBe(false);
  });

  it('parses approval_requested and final_output', () => {
    expect(
      parseLine('{"type":"approval_requested","tool_call_id":"c2","tool":"email.send"}')?.ok,
    ).toBe(true);
    expect(parseLine('{"type":"final_output","content":"done"}')?.ok).toBe(true);
  });
});

describe('LineBuffer', () => {
  it('emits only complete lines', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(buffer.push(':2}\n')).toEqual(['{"b":2}']);
  });

  it('reassembles a JSON object split across chunk boundaries', () => {
    const buffer = new LineBuffer();
    const parts = ['{"type":"fin', 'al_output","con', 'tent":"hi"}\n'];
    const lines = parts.flatMap((part) => buffer.push(part));
    expect(lines).toEqual(['{"type":"final_output","content":"hi"}']);
  });

  it('returns a trailing unterminated line on flush', () => {
    const buffer = new LineBuffer();
    buffer.push('{"a":1}');
    expect(buffer.flush()).toEqual(['{"a":1}']);
  });

  it('flushes nothing when the remainder is only whitespace', () => {
    const buffer = new LineBuffer();
    buffer.push('{"a":1}\n  ');
    expect(buffer.flush()).toEqual([]);
  });
});

describe('encodeLine', () => {
  it('appends exactly one newline', () => {
    expect(encodeLine({ type: 'shutdown' })).toBe('{"type":"shutdown"}\n');
  });
});
