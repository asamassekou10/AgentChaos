/**
 * Give the built CLI its executable bit.
 *
 * TypeScript emits 0644, and npm only chmods a bin target at the moment it
 * creates the .bin symlink. Installing over an existing link skips that step,
 * so a tarball built without this leaves the CLI unrunnable:
 *
 *   sh: node_modules/.bin/agent-chaos: Permission denied
 *
 * Correct from a checkout, broken through a real install path, invisible to
 * the test suite. The same shape as the 0.1.0 entry-point bug, so the fix
 * belongs in the build rather than in a release checklist someone has to
 * remember.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.dirname(url.fileURLToPath(import.meta.url));
const target = path.join(root, '..', 'dist', 'cli', 'index.js');

if (!fs.existsSync(target)) {
  process.stderr.write(`mark-bin-executable: ${target} does not exist. Did the build run?\n`);
  process.exit(1);
}

// 0o755 rather than a bitwise add: the point is a known-good mode, not
// whatever the previous one happened to be.
fs.chmodSync(target, 0o755);
