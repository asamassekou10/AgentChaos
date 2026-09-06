/**
 * `agent-chaos mcp-config`
 *
 * Prints the server entry a user pastes into the MCP config they already have.
 *
 * This exists because the config key differs per client and getting it wrong
 * produces silence rather than an error. Printing the exact block, with the
 * absolute config path already filled in, turns "integrate a testing tool" into
 * one copy and paste.
 */

import path from 'node:path';
import pc from 'picocolors';

/** MCP config file locations, for the note under the snippet. */
const CLIENT_HINTS: { name: string; location: string }[] = [
  { name: 'Claude Code', location: '.mcp.json in the project, or `claude mcp add`' },
  { name: 'Cursor', location: '.cursor/mcp.json' },
  { name: 'Windsurf', location: '~/.codeium/windsurf/mcp_config.json' },
  { name: 'Goose', location: '~/.config/goose/config.yaml' },
];

export function renderMcpConfig(scenarioId: string, configPath: string, color = true): string {
  const c = (fn: (t: string) => string, text: string): string => (color ? fn(text) : text);

  const entry = {
    mcpServers: {
      'agent-chaos': {
        command: 'npx',
        args: ['agent-chaos', 'serve', '--scenario', scenarioId, '--config', configPath],
      },
    },
  };

  const lines: string[] = [''];
  lines.push(`  ${c(pc.bold, 'Add this to your MCP config:')}`);
  lines.push('');
  for (const line of JSON.stringify(entry, null, 2).split('\n')) lines.push(`  ${line}`);
  lines.push('');
  lines.push(`  ${c(pc.dim, 'Where that file lives:')}`);
  for (const hint of CLIENT_HINTS) {
    lines.push(`    ${c(pc.dim, `${hint.name.padEnd(12)} ${hint.location}`)}`);
  }
  lines.push('');
  lines.push('  Then run your agent as usual and give it a task that reads a GitHub issue.');
  lines.push(`  When it finishes: ${c(pc.bold, `agent-chaos report --scenario ${scenarioId}`)}`);
  lines.push('');
  lines.push(
    `  ${c(pc.dim, 'For a complete verdict, point the agent at AgentChaos alone. It can only')}`,
  );
  lines.push(
    `  ${c(pc.dim, 'observe calls to its own tools, and it will say so when it sees others.')}`,
  );
  lines.push('');

  return lines.join('\n');
}

/** The same entry as data, for tests and for callers that want to write a file. */
export function mcpConfigEntry(scenarioId: string, configPath: string): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['agent-chaos', 'serve', '--scenario', scenarioId, '--config', path.resolve(configPath)],
  };
}
