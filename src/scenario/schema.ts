/**
 * Schema for a scenario file.
 *
 * A scenario is three things: what to inject, what must never happen as a
 * result, and what boundary that expresses. The third is not decoration. A
 * failure report that cannot say which boundary was crossed is a stack trace,
 * not a finding.
 */

import { z } from 'zod';
import { JsonValueSchema } from '../protocol/events.js';
// Type-only, so these are erased at build time and introduce no import cycle
// even though safety.ts and sources.ts both depend on this module's types.
import type { SafetyProblem } from './safety.js';
import type { ScenarioOrigin } from './sources.js';

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * What to substitute for a tool's result.
 *
 * `on_tool` names the tool whose result is replaced. The first matching call is
 * injected by default; `occurrence` selects a later one for scenarios that need
 * the agent to have seen a benign result first.
 */
export const InjectionSchema = z
  .object({
    on_tool: z.string().min(1),
    occurrence: z.number().int().positive().default(1),
    result: JsonValueSchema,
  })
  .strict();

/** Match a tool_call by name and arguments. */
const ToolMatcherShape = z
  .object({
    event: z.literal('tool_call'),
    tool: z.string().min(1).optional(),
    tool_matches: z.array(z.string().min(1)).optional(),
    arguments: z
      .object({
        /** Glob patterns tested against any path-like argument value. */
        path_matches: z.array(z.string().min(1)).optional(),
        /** Substrings tested against any string argument value. */
        contains: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * A matcher for `never`, where naming a tool is mandatory.
 *
 * A bare matcher under `never` would forbid every tool call the agent makes,
 * which no real scenario wants and which would pass review looking like it said
 * something specific. Requiring the field makes that mistake unwritable.
 */
export const ToolMatcherSchema = ToolMatcherShape.refine(
  (m) => m.tool !== undefined || m.tool_matches !== undefined,
  { message: 'a matcher under `never` needs either `tool` or `tool_matches`' },
);

/**
 * A matcher for `never_without_approval`, where omitting the tool is meaningful.
 *
 * A bare matcher here defers to `policy.require_approval`, so the scenario does
 * not restate a list the project already maintains. That is the opposite of the
 * `never` case: here the fallback is a real, useful default rather than an
 * accident.
 */
export const ApprovalMatcherSchema = ToolMatcherShape;

export type ToolMatcher = z.infer<typeof ToolMatcherShape>;

/**
 * The assertions a scenario can make.
 *
 * Every one of these is decidable from recorded events alone. That constraint
 * is what keeps a failure explainable: the evidence is the event list, and the
 * verdict is a function of it.
 */
export const AssertionsSchema = z
  .object({
    /** Any matching tool_call is a violation. */
    never: z.array(ToolMatcherSchema).default([]),
    /**
     * A matching tool_call is a violation unless an approval_requested event
     * for the same call arrived first.
     */
    never_without_approval: z.array(ApprovalMatcherSchema).default([]),
    /**
     * A value that must not travel. Violated when the string appears in a
     * later tool_call argument or in final_output.
     *
     * `sensitive_paths` and `require_approval` come from policy, but the secret
     * is per-scenario because it is fixture data the scenario itself planted.
     */
    no_secret_propagation: z
      .object({
        secret: z.string().min(1),
        /** Where the secret was planted, for the evidence trail. */
        planted_in: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * Enforce policy.allowed_tools. Any tool_call outside the allowlist is a
     * violation. Silently ignored when the allowlist is empty, which the
     * reporter surfaces rather than hides.
     */
    tool_allowlist: z.boolean().default(false),
  })
  .strict();

export type Assertions = z.infer<typeof AssertionsSchema>;

export const EvidenceSchema = z
  .object({
    /** Which tool carried the untrusted content. */
    source: z.string().min(1),
    /** The boundary in one sentence, quoted verbatim in failure output. */
    expected_boundary: z.string().min(1),
    /** What the user should change. Shown on failure. */
    mitigation: z.string().min(1).optional(),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    version: z.literal(1),
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case'),
    name: z.string().min(1),
    description: z.string().min(1),
    severity: SeveritySchema,
    inject: InjectionSchema,
    assert: AssertionsSchema,
    evidence: EvidenceSchema,
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;

/** A scenario plus where it came from, for error messages and provenance. */
export interface LoadedScenario {
  scenario: Scenario;
  filePath: string;
  /**
   * Which source supplied it.
   *
   * Optional so a caller constructing one by hand, as tests do, does not have
   * to invent an origin. Absent means local.
   */
  origin?: ScenarioOrigin;
  /** Safety problems found in the payload. Errors block loading. */
  safety?: SafetyProblem[];
}
