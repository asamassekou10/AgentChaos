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
    /** Extra local directories, for a project that splits its corpus up. */
    directories: z.array(z.string().min(1)).default([]),
    /**
     * Scenario packs installed from npm.
     *
     * npm is the registry. It already does fetching, versioning, lockfiles, and
     * integrity, and reimplementing any of that here would mean AgentChaos
     * making outbound requests, which it does not do.
     */
    packs: z.array(z.string().min(1)).default([]),
    /**
     * Run scenarios whose payload fails the safety check anyway.
     *
     * Off by default. A payload carrying a real-looking credential or naming a
     * routable host is a bug in the pack, and running it against a live agent is
     * how that bug becomes an incident.
     */
    allow_unsafe: z.boolean().default(false),
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

/**
 * A real MCP server to proxy in front of.
 *
 * Optional. Without it AgentChaos serves only simulated tools; with it the
 * agent reaches the real thing through AgentChaos, so every call is observed
 * and the tools behind it behave like production.
 */
export const UpstreamServerSchema = z
  .object({
    command: z.string().min(1, 'upstream command must not be empty'),
    env: z.record(z.string()).default({}),
    timeout_ms: z.number().int().positive().max(600_000).default(30_000),
  })
  .strict();

export const UpstreamSchema = z
  .object({
    servers: z.record(UpstreamServerSchema).default({}),
    /**
     * Tools that are never forwarded, answered with a simulated result instead.
     *
     * Defaults to `policy.require_approval`, resolved after parsing: a tool the
     * project already considers dangerous enough to need a human is exactly the
     * one that must not actually run during an attack simulation. Detecting the
     * violation only needs the attempt, not the consequence.
     */
    simulate_tools: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    agent: AgentConfigSchema,
    scenarios: ScenarioSourceSchema.default({
      directory: './agent-chaos/scenarios',
      directories: [],
      packs: [],
      allow_unsafe: false,
    }),
    policy: PolicySchema.default({ sensitive_paths: [], require_approval: [], allowed_tools: [] }),
    upstream: UpstreamSchema.default({ servers: {} }),
  })
  .strict();

export type AgentSettings = z.infer<typeof AgentConfigSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type UpstreamSettings = z.infer<typeof UpstreamSchema>;
export type UpstreamServerSettings = z.infer<typeof UpstreamServerSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Tools the proxy must never forward.
 *
 * `upstream.simulate_tools` when set, otherwise every tool the policy says
 * needs approval. Making the dangerous list the default means a project that
 * has already declared what is dangerous does not have to declare it twice, and
 * cannot forget to.
 */
export function simulatedToolPatterns(config: Config): string[] {
  return config.upstream.simulate_tools ?? [...config.policy.require_approval];
}

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
