/**
 * Loading and validating agent-chaos.yaml.
 *
 * Every failure path here produces a message naming the file, the field, and
 * what was expected. A configuration error costs the user a run, so it should
 * cost them one reading rather than one debugging session.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import { ConfigSchema, type LoadedConfig } from './schema.js';

/** A user-facing error. The CLI turns these into exit code 2. */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONFIG_FILENAME = 'agent-chaos.yaml';

/**
 * Find the config file.
 *
 * Only the given directory is searched, not its ancestors. Walking upward would
 * mean a run in a subdirectory could silently pick up a different project's
 * policy, and a security tool reading the wrong policy is worse than one that
 * says it cannot find a file.
 */
export function resolveConfigPath(explicit: string | undefined, cwd: string): string {
  if (explicit) {
    const resolved = path.resolve(cwd, explicit);
    if (!fs.existsSync(resolved)) {
      throw new ConfigError(`Config file not found: ${explicit}`, `Looked for ${resolved}`);
    }
    return resolved;
  }

  const candidates = [DEFAULT_CONFIG_FILENAME, 'agent-chaos.yml'];
  for (const name of candidates) {
    const resolved = path.join(cwd, name);
    if (fs.existsSync(resolved)) return resolved;
  }

  throw new ConfigError(
    `No ${DEFAULT_CONFIG_FILENAME} found in ${cwd}`,
    'Run `agent-chaos init` to create one, or pass --config <path>.',
  );
}

/** Render a Zod error as a list a person can act on. */
export function formatZodError(error: ZodError, label: string): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join('.') : label;
      return `  ${location}: ${issue.message}`;
    })
    .join('\n');
}

export function loadConfig(explicitPath: string | undefined, cwd: string): LoadedConfig {
  const configPath = resolveConfigPath(explicitPath, cwd);

  let source: string;
  try {
    source = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read ${configPath}`, (error as Error).message);
  }

  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new ConfigError(
      `${path.basename(configPath)} is not valid YAML`,
      (error as Error).message,
    );
  }

  if (raw === null || typeof raw !== 'object') {
    throw new ConfigError(
      `${path.basename(configPath)} is empty or not a mapping`,
      'Expected a YAML mapping with at least `version` and `agent`.',
    );
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `${path.basename(configPath)} failed validation`,
      formatZodError(parsed.error, 'config'),
    );
  }

  const rootDir = path.dirname(configPath);
  const scenarioDir = path.resolve(rootDir, parsed.data.scenarios.directory);

  return { config: parsed.data, configPath, rootDir, scenarioDir };
}
