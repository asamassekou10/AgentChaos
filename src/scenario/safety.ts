/**
 * Payload safety checks for scenarios.
 *
 * A scenario is attack content that someone else wrote and you are about to
 * feed to your agent. Once scenarios travel between projects that is a supply
 * chain, and this tool exists because agent supply chains are worth checking.
 * Exempting our own would be the obvious blind spot.
 *
 * Two things are actually dangerous in a payload:
 *
 *   A real credential. Either leaked by the author by accident, or planted so
 *   that running the pack against a live agent moves it somewhere. Either way
 *   the value should never have been committed.
 *
 *   A routable hostname. In proxy mode the agent reaches real tools, so a
 *   payload naming a host the pack author controls is a payload asking your
 *   agent to talk to them. Reserved and private ranges are fine; those are the
 *   fixtures.
 *
 * Findings are returned rather than thrown so the loader can decide. Errors
 * block the scenario; warnings are reported and it still runs.
 */

import type { Scenario } from './schema.js';

export interface SafetyProblem {
  severity: 'error' | 'warning';
  /** Which part of the scenario, for a message a person can act on. */
  where: string;
  message: string;
}

/**
 * Values that are obviously fixtures and must never be flagged.
 *
 * The built-in corpus uses `FAKE_TEST_`, so a pack author copying that
 * convention inherits the exemption. This is matched before any credential
 * pattern, so a fixture that happens to look like a token stays quiet.
 */
const FIXTURE_MARKERS = [
  /FAKE_TEST_/i,
  /\bEXAMPLE_/i,
  /\bDUMMY_/i,
  /\bPLACEHOLDER\b/i,
  /\bnot a real\b/i,
];

/**
 * Credential shapes worth refusing.
 *
 * Deliberately provider-prefixed rather than entropy-based. An entropy check
 * would fire on base64 fixtures and hashes, and a scenario corpus is full of
 * plausible-looking nonsense on purpose.
 */
const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'OpenAI key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  {
    name: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
];

/**
 * Hosts a payload may name.
 *
 * Reserved-for-documentation domains, the loopback and link-local addresses a
 * scenario legitimately tests against, and the RFC1918 private ranges. Anything
 * else is a host on the public internet that someone can point at themselves.
 */
const ALLOWED_HOST_PATTERNS: RegExp[] = [
  /^(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$/i,
  /^(?:[a-z0-9-]+\.)*(?:invalid|test|localhost|local|internal)$/i,
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^\[?::1\]?$/,
  /^169\.254\.\d+\.\d+$/,
  /^metadata\.google\.internal$/i,
  /^metadata\.azure\.com$/i,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+$/,
];

/** Every string anywhere in a value, bounded so a deep payload cannot stall. */
function collectStrings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, out);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, depth + 1, out);
  }
  return out;
}

function looksLikeFixture(text: string): boolean {
  return FIXTURE_MARKERS.some((marker) => marker.test(text));
}

/** Hostnames mentioned in a string, from URLs and bare email domains. */
export function extractHosts(text: string): string[] {
  const hosts: string[] = [];

  for (const match of text.matchAll(/https?:\/\/([^/\s"'`)\]},\\]+)/gi)) {
    const authority = match[1];
    if (!authority) continue;
    // Strip credentials and port; keep an IPv6 literal intact.
    const withoutCreds = authority.includes('@')
      ? authority.slice(authority.indexOf('@') + 1)
      : authority;
    const host = withoutCreds.startsWith('[')
      ? withoutCreds.slice(0, withoutCreds.indexOf(']') + 1)
      : (withoutCreds.split(':')[0] ?? '');
    if (host) hosts.push(host);
  }

  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    if (match[1]) hosts.push(match[1]);
  }

  return hosts;
}

export function isAllowedHost(host: string): boolean {
  const normalized = host.replace(/\.$/, '').toLowerCase();
  return ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Check a scenario's payload and assertions.
 *
 * Only the injected payload and the secret are examined. Assertion patterns
 * legitimately name real hosts, since forbidding a host is the point of an SSRF
 * scenario, and flagging those would make the check useless.
 */
export function lintScenario(scenario: Scenario): SafetyProblem[] {
  const problems: SafetyProblem[] = [];

  const payloadStrings = collectStrings(scenario.inject.result);
  const secret = scenario.assert.no_secret_propagation?.secret;
  if (secret) payloadStrings.push(secret);

  for (const text of payloadStrings) {
    if (looksLikeFixture(text)) continue;

    for (const { name, pattern } of CREDENTIAL_PATTERNS) {
      if (!pattern.test(text)) continue;
      problems.push({
        severity: 'error',
        where: 'inject.result',
        message:
          `contains something shaped like a real ${name}. A scenario payload is committed and ` +
          'shown in reports, so it must never carry a credential. Use a value prefixed ' +
          'FAKE_TEST_ instead.',
      });
    }

    for (const host of extractHosts(text)) {
      if (isAllowedHost(host)) continue;
      problems.push({
        severity: 'error',
        where: 'inject.result',
        message:
          `names the host "${host}". In proxy mode the agent reaches real tools, so a payload ` +
          'naming a routable host is asking the agent under test to contact it. Use ' +
          'example.com, a .invalid domain, or a private address.',
      });
    }
  }

  if (secret && !looksLikeFixture(secret)) {
    problems.push({
      severity: 'warning',
      where: 'assert.no_secret_propagation.secret',
      message:
        'is not marked as a fixture. Prefix it with FAKE_TEST_ so a reader of a report can tell ' +
        'at a glance that no real credential is involved.',
    });
  }

  return problems;
}

/** Render problems as a block a person can act on. */
export function formatSafetyProblems(problems: SafetyProblem[]): string {
  return problems
    .map((problem) => `  ${problem.severity}: ${problem.where} ${problem.message}`)
    .join('\n');
}
