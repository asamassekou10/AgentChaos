/**
 * Where scenarios come from.
 *
 * Scenarios are worth sharing between projects, and sharing needs a registry.
 * This one is npm.
 *
 * A scenario pack is an ordinary npm package that ships YAML files and declares
 * where they live. AgentChaos resolves it from node_modules and reads the
 * directory. It never fetches anything: npm already did that, with versioning,
 * lockfiles, and integrity hashes that this tool has no business reimplementing.
 * The promise that AgentChaos makes no outbound request survives, which it
 * would not if a registry lived in here.
 *
 * A pack declares itself in package.json:
 *
 *   {
 *     "name": "agent-chaos-scenarios-acme",
 *     "agentChaos": { "scenarios": "./scenarios" }
 *   }
 *
 * Provenance travels with every scenario, because "where did this attack come
 * from" is the first question to ask of content that will be fed to your agent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ConfigError } from '../config/load.js';

/** Where a scenario was loaded from. */
export interface ScenarioOrigin {
  kind: 'local' | 'pack';
  /** Directory the scenario file sits in. */
  directory: string;
  /** Package name, when the origin is a pack. */
  packName?: string;
  /** Package version, when it could be read. */
  packVersion?: string;
}

/** A short label for reports and `list`. */
export function describeOrigin(origin: ScenarioOrigin): string {
  if (origin.kind === 'local') return 'local';
  return origin.packVersion
    ? `${origin.packName}@${origin.packVersion}`
    : (origin.packName ?? 'pack');
}

interface PackManifest {
  name?: string;
  version?: string;
  agentChaos?: { scenarios?: string };
}

/**
 * Resolve a pack to the directory holding its scenarios.
 *
 * Resolution runs from the config file's directory so a pack installed in the
 * project being tested is found, not one that happens to sit near AgentChaos
 * itself. That matters when AgentChaos is run through npx from somewhere else.
 */
export function resolvePack(packName: string, fromDir: string): ScenarioOrigin {
  const require = createRequire(path.join(fromDir, 'noop.js'));

  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${packName}/package.json`);
  } catch {
    // Some packages restrict "exports" and refuse a package.json subpath. Fall
    // back to walking up from the entry point, which is where it must be.
    try {
      const entry = require.resolve(packName);
      manifestPath = findManifestAbove(entry, packName);
    } catch {
      throw new ConfigError(
        `Scenario pack "${packName}" is not installed`,
        `Install it in the project first, for example:\n  npm install --save-dev ${packName}`,
      );
    }
  }

  let manifest: PackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackManifest;
  } catch (error) {
    throw new ConfigError(
      `Could not read package.json for scenario pack "${packName}"`,
      (error as Error).message,
    );
  }

  const declared = manifest.agentChaos?.scenarios;
  if (!declared) {
    throw new ConfigError(
      `"${packName}" is not a scenario pack`,
      'A pack declares its scenario directory in package.json:\n' +
        '  { "agentChaos": { "scenarios": "./scenarios" } }',
    );
  }

  const directory = path.resolve(path.dirname(manifestPath), declared);
  if (!fs.existsSync(directory)) {
    throw new ConfigError(
      `Scenario pack "${packName}" points at a directory that does not exist`,
      `Its package.json declares "${declared}", resolved to ${directory}`,
    );
  }

  return {
    kind: 'pack',
    directory,
    packName: manifest.name ?? packName,
    ...(manifest.version !== undefined ? { packVersion: manifest.version } : {}),
  };
}

/** Walk up from a resolved entry point to the package.json that owns it. */
function findManifestAbove(entry: string, packName: string): string {
  let dir = path.dirname(entry);

  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new ConfigError(`Could not locate package.json for "${packName}"`);
}

/**
 * Every directory scenarios should be read from, in order.
 *
 * Local directories come first so a project can override a pack's scenario by
 * id, and the loader's duplicate-id check turns any accidental collision into
 * an error rather than a silent shadow.
 */
export function resolveSources(options: {
  rootDir: string;
  directories: string[];
  packs: string[];
}): ScenarioOrigin[] {
  const origins: ScenarioOrigin[] = options.directories.map((directory) => ({
    kind: 'local',
    directory: path.resolve(options.rootDir, directory),
  }));

  for (const pack of options.packs) origins.push(resolvePack(pack, options.rootDir));

  return origins;
}
