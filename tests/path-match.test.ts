import { describe, expect, it } from 'vitest';
import {
  collectStringValues,
  globToRegExp,
  matchAny,
  matchesPattern,
  normalizePath,
} from '../src/policy/path-match.js';

describe('normalizePath', () => {
  it('converts backslashes so a Windows-style argument matches a POSIX pattern', () => {
    expect(normalizePath('config\\local.env')).toBe('config/local.env');
  });

  it('strips leading ./ and collapses repeated slashes', () => {
    expect(normalizePath('./a//b/c')).toBe('a/b/c');
    expect(normalizePath('././x')).toBe('x');
  });

  it('drops a trailing slash but keeps a bare root', () => {
    expect(normalizePath('a/b/')).toBe('a/b');
    expect(normalizePath('/')).toBe('/');
  });

  it('preserves case, because .ENV and .env are different files', () => {
    expect(normalizePath('.ENV')).toBe('.ENV');
  });
});

describe('globToRegExp', () => {
  it('treats * as one segment', () => {
    const re = globToRegExp('a/*/c');
    expect(re.test('a/b/c')).toBe(true);
    expect(re.test('a/b/x/c')).toBe(false);
  });

  it('treats ? as a single character', () => {
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('file?.txt').test('file12.txt')).toBe(false);
  });

  it('escapes regex metacharacters so a dot is literal', () => {
    expect(globToRegExp('.env').test('.env')).toBe(true);
    expect(globToRegExp('.env').test('xenv')).toBe(false);
  });
});

describe('matchesPattern', () => {
  it('matches a pattern without a slash against the basename', () => {
    expect(matchesPattern('.env', '.env')).toBe(true);
    expect(matchesPattern('./.env', '.env')).toBe(true);
    expect(matchesPattern('/tmp/app/.env', '.env')).toBe(true);
  });

  it('does not let a basename pattern match a longer name', () => {
    expect(matchesPattern('.environment', '.env')).toBe(false);
    expect(matchesPattern('config/local.env', '.env')).toBe(false);
    expect(matchesPattern('env', '.env')).toBe(false);
  });

  it('matches **/name at any depth including the root', () => {
    expect(matchesPattern('credentials.json', '**/credentials.json')).toBe(true);
    expect(matchesPattern('a/credentials.json', '**/credentials.json')).toBe(true);
    expect(matchesPattern('a/b/c/credentials.json', '**/credentials.json')).toBe(true);
  });

  it('matches a directory wildcard on both sides', () => {
    expect(matchesPattern('home/user/.ssh/id_rsa', '**/.ssh/**')).toBe(true);
    expect(matchesPattern('home/user/.ssh/nested/key', '**/.ssh/**')).toBe(true);
    expect(matchesPattern('home/user/ssh/id_rsa', '**/.ssh/**')).toBe(false);
  });

  it('anchors a slash-bearing pattern, so a suffix alone does not match', () => {
    expect(matchesPattern('other/config/settings.json', 'config/settings.json')).toBe(false);
    expect(matchesPattern('config/settings.json', 'config/settings.json')).toBe(true);
  });

  it('matches tool names, which use the same matcher', () => {
    expect(matchesPattern('filesystem.write', 'filesystem.write')).toBe(true);
    expect(matchesPattern('filesystem.write', 'filesystem.*')).toBe(true);
    expect(matchesPattern('email.send', 'filesystem.*')).toBe(false);
  });
});

describe('matchAny', () => {
  it('returns the pattern that matched, for the evidence trail', () => {
    expect(matchAny('/app/.env', ['**/credentials.json', '.env'])).toBe('.env');
  });

  it('returns null when nothing matches', () => {
    expect(matchAny('src/index.ts', ['.env', '**/credentials.json'])).toBeNull();
  });
});

describe('collectStringValues', () => {
  it('finds a path under any key name, not just `path`', () => {
    const values = collectStringValues({ target: '.env', mode: 'read' });
    expect(values).toContain('.env');
  });

  it('walks nested objects and arrays', () => {
    const values = collectStringValues({ a: { b: [{ c: 'deep/.env' }] } });
    expect(values).toContain('deep/.env');
  });

  it('stops at a bounded depth so a pathological payload cannot blow up matching', () => {
    let nested: Record<string, unknown> = { value: 'found' };
    for (let i = 0; i < 40; i++) nested = { nested };

    const values = collectStringValues(nested);
    expect(values).not.toContain('found');
  });

  it('ignores non-string leaves', () => {
    expect(collectStringValues({ n: 1, b: true, z: null })).toEqual([]);
  });
});
