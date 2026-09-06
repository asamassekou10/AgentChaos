/**
 * The package version, read once from package.json.
 *
 * It was previously written into the MCP handshake as a literal in two files,
 * which meant a released server would introduce itself with whatever version
 * happened to be current when that line was typed. A client logging or
 * recording the handshake would have been told something untrue.
 *
 * Resolved relative to this module rather than the working directory, so it is
 * correct whether AgentChaos runs from a checkout, from node_modules, or
 * through npx.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      const pkgPath = fileURLToPath(new URL(relative, import.meta.url));
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'agent-chaos' && pkg.version) return pkg.version;
    } catch {
      // Try the next candidate.
    }
  }

  // Unknown is honest; a wrong number would be worse than an obvious blank.
  return '0.0.0-unknown';
}

export const VERSION = readVersion();
