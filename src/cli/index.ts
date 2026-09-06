#!/usr/bin/env node
/**
 * AgentChaos CLI entry point.
 *
 * Argument parsing and process concerns only. Everything a command actually
 * does lives in ./commands, which keeps those testable without spawning a
 * process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigError, loadConfig } from '../config/load.js';
import { loadScenarios, selectScenario } from '../scenario/load.js';
import { renderInitResult, runInit } from './commands/init.js';
import { renderScenarioList } from './commands/list.js';
import { EXIT_ERROR, runTests } from './commands/test.js';

function toolVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Print a ConfigError the way a person can act on. */
function reportError(error: unknown, color: boolean): void {
  const c = (fn: (t: string) => string, text: string): string => (color ? fn(text) : text);

  if (error instanceof ConfigError) {
    process.stderr.write(`\n${c(pc.red, 'Error')}  ${error.message}\n`);
    if (error.detail) process.stderr.write(`\n${error.detail}\n`);
    process.stderr.write('\n');
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n${c(pc.red, 'Error')}  ${message}\n\n`);
}

export function buildProgram(): Command {
  const program = new Command();
  const version = toolVersion();

  program
    .name('agent-chaos')
    .description('Safely attack your AI agent before someone else does.')
    .version(version, '-V, --version')
    .option('--no-color', 'disable coloured output');

  program
    .command('init')
    .description('Create agent-chaos.yaml and the built-in scenarios')
    .option('-f, --force', 'overwrite files that already exist', false)
    .action((options: { force: boolean }) => {
      const color = program.opts<{ color: boolean }>().color !== false;
      const cwd = process.cwd();
      const result = runInit({ force: options.force, cwd });
      process.stdout.write(renderInitResult(result, cwd, color));
    });

  program
    .command('list')
    .description('Show the available scenarios')
    .option('-c, --config <path>', 'path to agent-chaos.yaml')
    .action((options: { config?: string }) => {
      const color = program.opts<{ color: boolean }>().color !== false;
      try {
        const loaded = loadConfig(options.config, process.cwd());
        const scenarios = loadScenarios(loaded.scenarioDir);
        process.stdout.write(renderScenarioList(scenarios, color));
      } catch (error) {
        reportError(error, color);
        process.exitCode = EXIT_ERROR;
      }
    });

  program
    .command('test')
    .description('Run attack scenarios against the configured agent')
    .option('-c, --config <path>', 'path to agent-chaos.yaml')
    .option('-s, --scenario <id>', 'run a single scenario by id')
    .option('--json <path>', 'write a JSON report to this path')
    .option('--include-transcript', 'include the full event transcript in the JSON report', false)
    .option('-v, --verbose', 'show the event transcript for every scenario', false)
    .action(
      async (options: {
        config?: string;
        scenario?: string;
        json?: string;
        includeTranscript: boolean;
        verbose: boolean;
      }) => {
        const color = program.opts<{ color: boolean }>().color !== false;

        try {
          const loaded = loadConfig(options.config, process.cwd());
          const all = loadScenarios(loaded.scenarioDir);
          const selected = options.scenario ? selectScenario(all, options.scenario) : all;

          const outcome = await runTests(loaded, selected, {
            verbose: options.verbose,
            color,
            ...(options.json !== undefined ? { json: options.json } : {}),
            includeTranscript: options.includeTranscript,
            toolVersion: version,
          });

          process.stdout.write(outcome.humanReport);

          if (outcome.jsonPath) {
            process.stdout.write(
              `  JSON report written to ${path.relative(process.cwd(), outcome.jsonPath)}\n\n`,
            );
          }

          process.exitCode = outcome.exitCode;
        } catch (error) {
          reportError(error, color);
          process.exitCode = EXIT_ERROR;
        }
      },
    );

  return program;
}

/**
 * Whether this module was run as the program, rather than imported.
 *
 * Both sides are resolved through realpath before comparing. npm installs a
 * `bin` as a symlink in node_modules/.bin, so `process.argv[1]` is the link
 * while `import.meta.url` is its target. Comparing them unresolved meant the
 * guard was false for every installed user and the CLI exited silently with
 * status 0, printing nothing — working perfectly from a checkout and not at all
 * from `npm install`.
 */
const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;

  const real = (target: string): string => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  };

  return real(entry) === real(fileURLToPath(import.meta.url));
})();

if (isDirectRun) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      reportError(error, true);
      process.exitCode = EXIT_ERROR;
    });
}
