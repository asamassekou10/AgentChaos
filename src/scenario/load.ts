/**
 * Loading scenario files.
 *
 * Scenarios arrive from local directories and from npm-installed packs. Every
 * one is validated against the schema and then checked for payload safety,
 * because a pack is content someone else wrote that you are about to feed to
 * your agent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigError, formatZodError } from '../config/load.js';
import { ScenarioSchema, type LoadedScenario } from './schema.js';
import { formatSafetyProblems, lintScenario } from './safety.js';
import { describeOrigin, resolveSources, type ScenarioOrigin } from './sources.js';

const SCENARIO_EXTENSIONS = new Set(['.yaml', '.yml']);

export interface LoadScenarioOptions {
  /** Run scenarios whose payload failed the safety check. */
  allowUnsafe?: boolean;
}

/**
 * Read and validate every scenario in a directory.
 *
 * Results are sorted by id so a report is byte-identical across machines,
 * regardless of what order the filesystem hands back. CI diffing two reports
 * should surface behaviour changes, not directory-ordering noise.
 */
export function loadScenarios(
  scenarioDir: string,
  options: LoadScenarioOptions = {},
): LoadedScenario[] {
  return loadFromSources([{ kind: 'local', directory: scenarioDir }], options);
}

/**
 * Read scenarios from every configured source.
 *
 * Local directories are read before packs, so a project can see immediately
 * when its own scenario collides with a pack's: the duplicate-id check turns
 * that into an error naming both files rather than a silent shadow.
 */
export function loadFromSources(
  origins: ScenarioOrigin[],
  options: LoadScenarioOptions = {},
): LoadedScenario[] {
  const loaded: LoadedScenario[] = [];

  for (const origin of origins) {
    for (const filePath of scenarioFilesIn(origin.directory)) {
      loaded.push(loadScenarioFile(filePath, origin));
    }
  }

  if (loaded.length === 0) {
    const where = origins.map((origin) => origin.directory).join(', ');
    throw new ConfigError(
      `No scenario files found in ${where}`,
      'Scenario files are .yaml or .yml. Run `agent-chaos init` to write the defaults.',
    );
  }

  assertUniqueIds(loaded);
  assertSafe(loaded, options.allowUnsafe === true);

  return loaded.sort((a, b) => a.scenario.id.localeCompare(b.scenario.id));
}

function scenarioFilesIn(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    throw new ConfigError(
      `Scenario directory not found: ${directory}`,
      'Run `agent-chaos init` to create the default scenarios, or point `scenarios.directory` somewhere else.',
    );
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch (error) {
    throw new ConfigError(`Could not read ${directory}`, (error as Error).message);
  }

  return entries
    .filter((name) => SCENARIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(directory, name))
    .sort();
}

function assertUniqueIds(loaded: LoadedScenario[]): void {
  const seen = new Map<string, LoadedScenario>();

  for (const entry of loaded) {
    const previous = seen.get(entry.scenario.id);
    if (previous) {
      throw new ConfigError(
        `Duplicate scenario id "${entry.scenario.id}"`,
        `Defined in ${describeSource(previous)} and ${describeSource(entry)}. ` +
          'Ids select scenarios on the command line, so they must be unique. ' +
          'Rename one, or drop the pack that supplies it.',
      );
    }
    seen.set(entry.scenario.id, entry);
  }
}

function describeSource(entry: LoadedScenario): string {
  const origin = entry.origin ? describeOrigin(entry.origin) : 'local';
  return `${path.basename(entry.filePath)} (${origin})`;
}

/**
 * Refuse to run a scenario whose payload is unsafe.
 *
 * The block is deliberate rather than advisory. A payload carrying a
 * real-looking credential, or naming a host somebody controls, becomes an
 * outbound problem the moment it runs against a live agent in proxy mode. That
 * is a bug in the pack, and the right time to find it is before the run.
 */
function assertSafe(loaded: LoadedScenario[], allowUnsafe: boolean): void {
  const blocking = loaded.filter((entry) =>
    (entry.safety ?? []).some((problem) => problem.severity === 'error'),
  );

  if (blocking.length === 0 || allowUnsafe) return;

  const detail = blocking
    .map((entry) => {
      const errors = (entry.safety ?? []).filter((problem) => problem.severity === 'error');
      return `${describeSource(entry)} — scenario "${entry.scenario.id}"\n${formatSafetyProblems(errors)}`;
    })
    .join('\n\n');

  throw new ConfigError(
    `${blocking.length} scenario(s) have an unsafe payload`,
    `${detail}\n\nSet scenarios.allow_unsafe: true to run them anyway, but read them first.`,
  );
}

export function loadScenarioFile(filePath: string, origin?: ScenarioOrigin): LoadedScenario {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read ${filePath}`, (error as Error).message);
  }

  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new ConfigError(`${path.basename(filePath)} is not valid YAML`, (error as Error).message);
  }

  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `${path.basename(filePath)} failed validation`,
      formatZodError(parsed.error, 'scenario'),
    );
  }

  return {
    scenario: parsed.data,
    filePath,
    ...(origin !== undefined ? { origin } : {}),
    safety: lintScenario(parsed.data),
  };
}

/** Resolve every configured source and load from all of them. */
export function loadConfiguredScenarios(loaded: {
  rootDir: string;
  config: {
    scenarios: { directory: string; directories: string[]; packs: string[]; allow_unsafe: boolean };
  };
}): LoadedScenario[] {
  const origins = resolveSources({
    rootDir: loaded.rootDir,
    directories: [loaded.config.scenarios.directory, ...loaded.config.scenarios.directories],
    packs: loaded.config.scenarios.packs,
  });

  return loadFromSources(origins, { allowUnsafe: loaded.config.scenarios.allow_unsafe });
}

/** Narrow a scenario list to one id, with a message that lists the real ones. */
export function selectScenario(scenarios: LoadedScenario[], id: string): LoadedScenario[] {
  const match = scenarios.find((s) => s.scenario.id === id);
  if (!match) {
    const available = scenarios.map((s) => `  ${s.scenario.id}`).join('\n');
    throw new ConfigError(`No scenario with id "${id}"`, `Available scenarios:\n${available}`);
  }
  return [match];
}
