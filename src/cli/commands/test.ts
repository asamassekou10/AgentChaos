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
import { buildAnnotations, formatAnnotation, renderJobSummary } from '../../report/github.js';

export const EXIT_OK = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_ERROR = 2;

export interface TestOptions {
  verbose: boolean;
  color: boolean;
  json?: string;
  includeTranscript: boolean;
  toolVersion: string;
  /**
   * Emit GitHub Actions annotations and a job summary.
   *
   * Enabled explicitly rather than by sniffing the CI environment. A tool that
   * changes its output because it guessed where it was running is a tool whose
   * output you cannot reproduce locally.
   */
  github?: boolean;
  /** Where the job summary is written. Defaults to $GITHUB_STEP_SUMMARY. */
  githubSummaryPath?: string;
  /** Root that annotation file paths are made relative to. */
  repoRoot?: string;
  /** Treat an inconclusive run as a failure. Off by default. */
  failOnInconclusive?: boolean;
}

export interface TestOutcome {
  exitCode: number;
  runs: ScenarioRun[];
  humanReport: string;
  jsonPath?: string;
  /** Workflow command lines, when `github` was set. */
  annotations?: string[];
  jobSummary?: string;
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

  const exitCode = hasViolation
    ? EXIT_VIOLATION
    : hasInconclusive && options.failOnInconclusive !== false
      ? EXIT_ERROR
      : EXIT_OK;

  let annotations: string[] | undefined;
  let jobSummary: string | undefined;

  if (options.github) {
    const repoRoot = options.repoRoot ?? process.cwd();
    annotations = buildAnnotations(runs, repoRoot).map(formatAnnotation);
    jobSummary = renderJobSummary(runs);

    const summaryPath = options.githubSummaryPath ?? process.env['GITHUB_STEP_SUMMARY'];
    if (summaryPath) {
      // Appended, not overwritten: a workflow may have written to the summary
      // before this step, and clobbering someone else's output would be rude
      // and hard to debug.
      fs.appendFileSync(summaryPath, `${jobSummary}\n`, 'utf8');
    }
  }

  return {
    exitCode,
    runs,
    humanReport,
    ...(jsonPath !== undefined ? { jsonPath } : {}),
    ...(annotations !== undefined ? { annotations } : {}),
    ...(jobSummary !== undefined ? { jobSummary } : {}),
  };
}
