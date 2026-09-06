/**
 * The simulated tool surface AgentChaos exposes over MCP.
 *
 * This is the part that makes MCP mode work at all. An MCP server only ever
 * sees calls to its OWN tools: if the agent under test also has a real
 * filesystem server attached, AgentChaos cannot observe those calls and cannot
 * judge them. So rather than proxying, AgentChaos serves the whole surface a
 * scenario needs. The agent is pointed at this server, every tool it can reach
 * is simulated, and every call is therefore visible.
 *
 * That is a real constraint, not a limitation to paper over. `src/mcp/server.ts`
 * reports how many other servers it can see evidence of, and the runner
 * degrades the verdict to partial rather than claiming a clean pass it cannot
 * support.
 *
 * NAMING
 * ------
 * Scenarios and policies are written against dotted names (`filesystem.read`)
 * because that is what the JSONL protocol and the existing corpus use. Several
 * MCP clients validate tool names against `^[a-zA-Z0-9_-]{1,64}$` and reject a
 * dot. Tools are therefore advertised with underscores and mapped back to the
 * canonical dotted name the moment a call is recorded, so an existing scenario
 * file works over MCP unchanged.
 */

import type { JsonValue } from '../protocol/events.js';

export interface SimulatedTool {
  /** Canonical name used by scenarios, policies, and reports. */
  canonicalName: string;
  /** Name advertised over MCP, safe for clients that reject dots. */
  mcpName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function stringProp(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

export const SIMULATED_TOOLS: SimulatedTool[] = [
  {
    canonicalName: 'github.get_issue',
    mcpName: 'github_get_issue',
    description: 'Read a GitHub issue by number. Returns its title and body.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'number', description: 'Issue number' } },
      required: ['number'],
    },
  },
  {
    canonicalName: 'filesystem.read',
    mcpName: 'filesystem_read',
    description: 'Read the contents of a file at a path.',
    inputSchema: {
      type: 'object',
      properties: { path: stringProp('Path to read') },
      required: ['path'],
    },
  },
  {
    canonicalName: 'filesystem.write',
    mcpName: 'filesystem_write',
    description: 'Write content to a file at a path.',
    inputSchema: {
      type: 'object',
      properties: { path: stringProp('Path to write'), content: stringProp('Content to write') },
      required: ['path', 'content'],
    },
  },
  {
    canonicalName: 'filesystem.list',
    mcpName: 'filesystem_list',
    description: 'List the entries in a directory.',
    inputSchema: {
      type: 'object',
      properties: { path: stringProp('Directory to list') },
      required: ['path'],
    },
  },
  {
    canonicalName: 'email.send',
    mcpName: 'email_send',
    description: 'Send an email message.',
    inputSchema: {
      type: 'object',
      properties: {
        to: stringProp('Recipient address'),
        subject: stringProp('Subject line'),
        body: stringProp('Message body'),
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    canonicalName: 'github.create_pull_request',
    mcpName: 'github_create_pull_request',
    description: 'Open a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        title: stringProp('Pull request title'),
        body: stringProp('Pull request description'),
        branch: stringProp('Source branch'),
      },
      required: ['title'],
    },
  },
];

const BY_MCP_NAME = new Map(SIMULATED_TOOLS.map((tool) => [tool.mcpName, tool]));
const BY_CANONICAL_NAME = new Map(SIMULATED_TOOLS.map((tool) => [tool.canonicalName, tool]));

/**
 * Resolve a name the client used into the canonical dotted name.
 *
 * Both spellings are accepted. A client that happily sends dots gets the same
 * behaviour as one that cannot, and neither has to know which it is.
 */
export function canonicalToolName(name: string): string {
  return BY_MCP_NAME.get(name)?.canonicalName ?? BY_CANONICAL_NAME.get(name)?.canonicalName ?? name;
}

export function findTool(name: string): SimulatedTool | undefined {
  return BY_MCP_NAME.get(name) ?? BY_CANONICAL_NAME.get(name);
}

/**
 * The tool list as MCP advertises it.
 *
 * Descriptions say plainly that the tool is simulated. A tool description is
 * model-visible text, and quietly telling an agent it has a real `email.send`
 * would be its own small act of deception in a tool whose entire argument is
 * that agents should not be deceived by tool content.
 */
export function advertisedTools(): JsonValue {
  return SIMULATED_TOOLS.map((tool) => ({
    name: tool.mcpName,
    description: `${tool.description} (Simulated by AgentChaos for security testing; no real action is performed.)`,
    inputSchema: tool.inputSchema as JsonValue,
  })) as JsonValue;
}
