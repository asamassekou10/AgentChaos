/**
 * Public API.
 *
 * AgentChaos is primarily a CLI, but the engine is importable so a project can
 * run scenarios inside its own test suite. The surface is intentionally small:
 * these are the pieces needed to load a config, run scenarios, and read the
 * result. Everything else is an implementation detail and may change.
 */

export { loadConfig, ConfigError, resolveConfigPath } from './config/load.js';
export { ConfigSchema, PolicySchema } from './config/schema.js';
export type { Config, LoadedConfig, Policy, AgentSettings } from './config/schema.js';

export { loadScenarios, loadScenarioFile, selectScenario } from './scenario/load.js';
export { ScenarioSchema } from './scenario/schema.js';
export type { Scenario, LoadedScenario, Severity, Assertions } from './scenario/schema.js';

export { runScenario, createTransport } from './engine/runner.js';
export type { ScenarioRun } from './engine/runner.js';
export { Recorder } from './engine/recorder.js';
export { Injector, defaultResultFor } from './engine/injector.js';

export { evaluate, matchesToolCall } from './policy/assertions.js';
export type { Violation, EvaluationResult } from './policy/assertions.js';
export { matchesPattern, matchAny, normalizePath, globToRegExp } from './policy/path-match.js';

export { parseLine, LineBuffer, encodeLine } from './protocol/parse.js';
export { AgentEventSchema } from './protocol/events.js';
export type {
  AgentEvent,
  HarnessMessage,
  RecordedEvent,
  ToolCallEvent,
  ToolResultMessage,
} from './protocol/events.js';

export type { Transport, TransportHandlers, TransportRunResult } from './transport/types.js';
export { JsonlStdioTransport, splitCommand } from './transport/jsonl-stdio.js';

export { buildEvidence } from './evidence/builder.js';
export type { Evidence, EvidenceStep } from './evidence/builder.js';

export { buildJsonReport, serializeJsonReport, REPORT_VERSION } from './report/json.js';
export type { JsonReport, JsonScenarioResult, JsonViolation } from './report/json.js';
export { renderHumanReport } from './report/human.js';

export { runTests, finishRuns, EXIT_OK, EXIT_VIOLATION, EXIT_ERROR } from './cli/commands/test.js';
export type { TestOutcome, TestOptions } from './cli/commands/test.js';

export { McpServer } from './mcp/server.js';
export { SIMULATED_TOOLS, advertisedTools, canonicalToolName, findTool } from './mcp/tools.js';
export type { SimulatedTool } from './mcp/tools.js';
export { SessionWriter, readSession, sessionPath, SESSION_DIR } from './engine/session.js';
export type { SessionHeader, SessionRecording } from './engine/session.js';
export { runFromSession } from './cli/commands/report.js';
export { startMcpServer } from './cli/commands/serve.js';
export { renderMcpConfig, mcpConfigEntry } from './cli/commands/mcp-config.js';
