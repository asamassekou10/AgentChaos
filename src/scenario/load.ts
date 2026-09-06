/**
 * Loading scenario files from a directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigError, formatZodError } from '../config/load.js';
import { ScenarioSchema, type LoadedScenario } from './schema.js';

const SCENARIO_EXTENSIONS = new Set(['.yaml', '.yml']);

/**
 * Read and validate every scenario in a directory.
 *
 * Results are sorted by id so a report is byte-identical across machines,
 * regardless of what order the filesystem hands back. CI diffing two reports
 * should surface behaviour changes, not directory-ordering noise.
 */
export function loadScenarios(scenarioDir: string): LoadedScenario[] {
  if (!fs.existsSync(scenarioDir)) {
    throw new ConfigError(
      `Scenario directory not found: ${scenarioDir}`,
      'Run `agent-chaos init` to create the default scenarios, or point `scenarios.directory` somewhere else.',
    );
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(scenarioDir);
  } catch (error) {
    throw new ConfigError(`Could not read ${scenarioDir}`, (error as Error).message);
  }

  const files = entries
    .filter((name) => SCENARIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(scenarioDir, name))
    .sort();

  if (files.length === 0) {
    throw new ConfigError(
      `No scenario files in ${scenarioDir}`,
      'Scenario files are .yaml or .yml. Run `agent-chaos init` to write the defaults.',
    );
  }

  const loaded = files.map((filePath) => loadScenarioFile(filePath));

  const seen = new Map<string, string>();
  for (const { scenario, filePath } of loaded) {
    const previous = seen.get(scenario.id);
    if (previous) {
      throw new ConfigError(
        `Duplicate scenario id "${scenario.id}"`,
        `Defined in both ${path.basename(previous)} and ${path.basename(filePath)}. Ids select scenarios on the command line, so they must be unique.`,
      );
    }
    seen.set(scenario.id, filePath);
  }

  return loaded.sort((a, b) => a.scenario.id.localeCompare(b.scenario.id));
}

export function loadScenarioFile(filePath: string): LoadedScenario {
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

  return { scenario: parsed.data, filePath };
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
