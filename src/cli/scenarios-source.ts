/**
 * Access to the scenarios that ship with the package.
 *
 * These are read from the packaged `agent-chaos/scenarios` directory rather
 * than embedded as string literals, so the files `init` writes are byte-for-byte
 * the files the project's own tests run against. Embedding them would create
 * two copies that drift.
 *
 * The path resolves the same way from `src/cli` under vitest and from
 * `dist/cli` after a build, because both sit two levels below the package root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuiltinScenarioFile {
  filename: string;
  contents: string;
}

export function builtinScenarioDir(): string {
  return fileURLToPath(new URL('../../agent-chaos/scenarios', import.meta.url));
}

export function builtinScenarioFiles(): BuiltinScenarioFile[] {
  const dir = builtinScenarioDir();

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((filename) => ({
      filename,
      contents: fs.readFileSync(path.join(dir, filename), 'utf8'),
    }));
}
