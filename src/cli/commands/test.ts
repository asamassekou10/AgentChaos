/**
 * `agent-chaos test`
 *
 * Runs scenarios and decides the exit code.
 *
 *   0  every scenario passed
 *   1  at least one security assertion was violated
 *   2  configuration or execution error, including inconclusive runs
 *
 * Inconclusive belongs with 2 rather than 1. A run that could not deliver its
 * payload has not found a vulnerability, and reporting it as one would train
 * people to ignore exit code 1. It also has not demonstrated safety, so it
 * cannot be 0.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LoadedConfig } from '../../config/schema.js';
import { runScenario, type ScenarioRun } from '../../engine/runner.js';
import type { LoadedScenario } from '../../scenario/schema.js';
import { buildJsonReport, serializeJsonReport } from '../../report/json.js';
import { renderHumanReport } from '../../report/human.js';

export const EXIT_OK = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_ERROR = 2;

export interface TestOptions {
  verbose: boolean;
  color: boolean;
  json?: string;
  includeTranscript: boolean;
  toolVersion: string;
}

export interface TestOutcome {
  exitCode: number;
  runs: ScenarioRun[];
  humanReport: string;
  jsonPath?: string;
}

export async function runTests(
  loaded: LoadedConfig,
  scenarios: LoadedScenario[],
  options: TestOptions,
): Promise<TestOutcome> {
  const runs: ScenarioRun[] = [];

  // Sequential by design. Concurrent runs would interleave child process output
  // and make the ordering that approval assertions depend on unreproducible.
  for (const scenario of scenarios) {
    runs.push(await runScenario(loaded, scenario));
  }

  return finishRuns(runs, options);
}

/**
 * Render, write, and score a set of runs.
 *
 * Split out so `report` reaches the same verdict as `test`. An MCP session and
 * a JSONL run produce the same ScenarioRun objects, so they must produce the
 * same output and the same exit code; sharing the code is what guarantees that
 * rather than two implementations that agree today.
 */
export function finishRuns(runs: ScenarioRun[], options: TestOptions): TestOutcome {
  const humanReport = renderHumanReport(runs, {
    verbose: options.verbose,
    color: options.color,
  });

  let jsonPath: string | undefined;
  if (options.json) {
    const report = buildJsonReport(runs, {
      toolVersion: options.toolVersion,
      includeTranscript: options.includeTranscript,
    });
    jsonPath = path.resolve(process.cwd(), options.json);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, serializeJsonReport(report), 'utf8');
  }

  const hasViolation = runs.some((r) => !r.passed && !r.inconclusiveReason);
  const hasInconclusive = runs.some((r) => r.inconclusiveReason);

  const exitCode = hasViolation ? EXIT_VIOLATION : hasInconclusive ? EXIT_ERROR : EXIT_OK;

  return { exitCode, runs, humanReport, ...(jsonPath !== undefined ? { jsonPath } : {}) };
}
