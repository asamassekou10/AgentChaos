/**
 * Glob matching for sensitive paths.
 *
 * Written rather than taken from a dependency because the matching rule here is
 * not quite standard globbing, and a subtle mismatch between what a user writes
 * in `sensitive_paths` and what actually matches is a silent security-test
 * failure. The rule is small enough to state completely:
 *
 *   A pattern with no `/` matches the BASENAME.
 *     `.env` matches `.env`, `./.env`, `/tmp/app/.env`
 *     `.env` does NOT match `.environment` or `env`
 *
 *   A pattern containing `/` matches the FULL normalised path, anchored at
 *   either end, with `**` allowed to stand in for leading directories.
 *     `**\/credentials.json` matches `a/b/credentials.json` and `credentials.json`
 *     `**\/.ssh/**` matches `home/user/.ssh/id_rsa`
 *
 * Wildcards: `*` spans one segment, `**` spans any number, `?` is one
 * character. Everything else is literal.
 */

/**
 * Normalise a path for comparison.
 *
 * Backslashes become forward slashes so a Windows-style argument still matches
 * a POSIX-style pattern, `./` prefixes are dropped, and duplicate slashes
 * collapse. Case is preserved: on the systems this tool targets, `.ENV` and
 * `.env` are genuinely different files, and folding them would invent matches.
 */
export function normalizePath(input: string): string {
  let value = input.replace(/\\/g, '/');
  value = value.replace(/\/{2,}/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/** Escape the regex metacharacters that are literal in a glob. */
function escapeLiteral(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a glob to an anchored regular expression.
 *
 * `**` is handled before `*` so the longer token wins, and a `**` that occupies
 * a whole segment also consumes the following separator. Without that,
 * `**\/credentials.json` would fail to match a bare `credentials.json` at the
 * root, which is the case most likely to matter.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i]!;

    if (char === '*') {
      const isDouble = pattern[i + 1] === '*';
      if (isDouble) {
        const followedBySlash = pattern[i + 2] === '/';
        if (followedBySlash) {
          // `**/` matches any number of leading segments, including none.
          source += '(?:[^/]*(?:/[^/]*)*/)?';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
        continue;
      }
      source += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }

    source += escapeLiteral(char);
    i += 1;
  }

  return new RegExp(`^${source}$`);
}

/** Whether one path matches one pattern, using the basename rule above. */
export function matchesPattern(candidate: string, pattern: string): boolean {
  const path = normalizePath(candidate);
  const glob = normalizePath(pattern);

  if (!glob.includes('/')) {
    const basename = path.slice(path.lastIndexOf('/') + 1);
    return globToRegExp(glob).test(basename);
  }

  return globToRegExp(glob).test(path);
}

/** Whether a path matches any pattern. Returns the pattern that matched. */
export function matchAny(candidate: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (matchesPattern(candidate, pattern)) return pattern;
  }
  return null;
}

/**
 * Pull every plausibly path-like string out of a tool call's arguments.
 *
 * Arguments are attacker-influenced and their shape is not fixed, so rather
 * than trusting a conventional key name this walks the whole structure. Missing
 * a path because it arrived as `target` instead of `path` would be exactly the
 * kind of false negative this tool must not produce.
 *
 * Nesting is bounded so a pathological payload cannot make matching expensive.
 */
export function collectStringValues(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out;

  if (typeof value === 'string') {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, depth + 1, out);
    return out;
  }

  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, depth + 1, out);
  }

  return out;
}
