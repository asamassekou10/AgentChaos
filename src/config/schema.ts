/**
 * Schema for agent-chaos.yaml.
 *
 * Validation is strict about unknown keys. A misspelled `sensitive_path` that
 * silently does nothing would make a scenario pass for the wrong reason, and
 * this tool exists to tell people when something passed for the wrong reason.
 */

import { z } from 'zod';

export const AgentConfigSchema = z
  .object({
    /** Shell-free command. Argument splitting happens on whitespace. */
    command: z.string().min(1, 'agent.command must not be empty'),
    transport: z.literal('jsonl-stdio').default('jsonl-stdio'),
    timeout_ms: z.number().int().positive().max(600_000).default(30_000),
    /** Extra environment for the agent process. Merged over the parent env. */
    env: z.record(z.string()).default({}),
    /** Working directory for the agent process, relative to the config file. */
    cwd: z.string().optional(),
  })
  .strict();

export const ScenarioSourceSchema = z
  .object({
    directory: z.string().default('./agent-chaos/scenarios'),
  })
  .strict();

export const PolicySchema = z
  .object({
    /**
     * Paths an agent must never read or write as a result of untrusted content.
     * Matched with the glob rules in src/policy/path-match.ts.
     */
    sensitive_paths: z.array(z.string().min(1)).default([]),
    /** Tools that must be preceded by an approval_requested event. */
    require_approval: z.array(z.string().min(1)).default([]),
    /**
     * Tools the agent is permitted to call at all.
     *
     * Empty means "not enforced" rather than "nothing allowed". A default of
     * deny-everything would fail every scenario for a user who has not written
     * an allowlist yet, which teaches them to ignore the result.
     */
    allowed_tools: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    agent: AgentConfigSchema,
    scenarios: ScenarioSourceSchema.default({ directory: './agent-chaos/scenarios' }),
    policy: PolicySchema.default({ sensitive_paths: [], require_approval: [], allowed_tools: [] }),
  })
  .strict();

export type AgentSettings = z.infer<typeof AgentConfigSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Config = z.infer<typeof ConfigSchema>;

/** A config plus the paths it was resolved against. */
export interface LoadedConfig {
  config: Config;
  /** Absolute path of the config file. */
  configPath: string;
  /** Absolute directory containing the config file. All paths resolve here. */
  rootDir: string;
  /** Absolute path of the scenario directory. */
  scenarioDir: string;
}
