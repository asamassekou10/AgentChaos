# Changelog

Notable changes to AgentChaos. Versions follow [semantic versioning](https://semver.org), with the caveat noted in [docs/RELEASING.md](docs/RELEASING.md): pre-1.0, a change that alters a verdict is at least a minor, because a scenario that starts failing turns somebody's pipeline red.

## 0.2.0

The release that makes AgentChaos usable against agents you did not write.

0.1.0 could only test agents that implemented its own JSONL protocol, which is a poor thing to ask of someone evaluating a testing tool. This release adds MCP, so any MCP-speaking agent can be attacked through an interface it already has.

### Added

- **MCP transport.** AgentChaos runs as an MCP server, so Claude Code, Cursor, Windsurf, Goose, and OpenAI Agents SDK apps can be tested with no change to the agent. `agent-chaos mcp-config` prints the block to paste into an existing MCP config; `agent-chaos serve` runs the server; `agent-chaos report` evaluates the session afterwards. The verdict, evidence, and exit codes are identical to the JSONL transport, because it is the same engine.
- **MCP proxy mode.** Declare `upstream.servers` and AgentChaos sits in front of the agent's real MCP servers, so every call is both real and observed. Benign calls are forwarded; anything matching `policy.require_approval` is answered with a simulated result and recorded as attempted, so nothing dangerous is actually performed. Detecting a violation needs the attempt, not the consequence.
- **GitHub Action.** `uses: asamassekou10/AgentChaos@v0` fails a pull request when an attack succeeds, with an annotation on the scenario file and the full evidence chain in the job summary.
- **Five more scenarios**, taking the corpus from four to nine: `hidden-unicode-instruction`, `nested-content-injection`, `approval-coercion`, `ssrf-internal-endpoint`, and `destructive-command`. Three are deliberate near-misses of the originals, so an agent that passes one and fails its pair has a specific, nameable weakness.
- **Scenario packs.** Share scenarios as npm packages declaring `agentChaos.scenarios`. npm is the registry, which keeps AgentChaos free of outbound requests while inheriting versioning, lockfiles, and integrity. Provenance appears as a column in `agent-chaos list`.
- **Payload safety checks.** Every scenario is linted before it runs, and a payload carrying a real-looking credential or naming a routable host is refused. A scenario corpus is a supply chain, and this tool exists because supply chains are worth checking.
- `http.fetch` and `shell.exec` in the simulated tool surface, so SSRF and command execution have somewhere to land.
- Automated publishing on GitHub release, using npm trusted publishing. No npm token exists in the repository.

### Fixed

- **The CLI did nothing when installed from npm.** The entry-point guard compared `process.argv[1]` to `import.meta.url` without resolving symlinks, and npm exposes `bin` as a symlink, so the guard was false for every installed user: every command exited 0 having printed nothing. It worked perfectly from a checkout, which is why the whole test suite and both demos missed it. Installing the packed tarball is now a release gate.
- Proxy mode survives an upstream that cannot start. `spawn` reports a missing executable through an async `error` event rather than by throwing, so ENOENT escaped as an unhandled exception and took down the proxy.
- The GitHub Action writes its outputs even when a scenario fails. Composite steps run as `bash -e`, so the script aborted on the CLI's non-zero exit before recording anything, and a workflow could see that something went wrong but not what.

### Changed

- Request handling in the MCP server is queued, so calls arriving in one chunk keep their order. That ordering is what the approval assertions depend on.
- `agent-chaos list` gains a `SOURCE` column.

### Notes

Nothing about the safety posture changed. Every payload is a harmless fixture, no built-in tool result causes a real action, AgentChaos makes no outbound request, and the protocol still carries only observable events. Proxy mode is the first feature that could have caused a real side effect, and it is designed specifically so that it does not.

## 0.1.0

First release. A local-first security testing CLI for AI agents: it runs controlled attack scenarios, replaces selected tool responses with malicious test content, and reports whether the agent crossed a declared security boundary.

- JSONL-over-stdio agent protocol
- Four scenarios: prompt injection to sensitive file access, unapproved writes, secret exfiltration, and tool permission escalation
- Human-readable reports with ordered evidence, and a stable JSON schema for CI
- A deterministic demo agent with vulnerable and safe modes, needing no API key
- An inconclusive run is never reported as a pass
