The release that makes AgentChaos usable against agents you did not write.

0.1.0 could only test agents that implemented its own JSONL protocol, which is a poor thing to ask of someone evaluating a testing tool. This release adds MCP, so any MCP-speaking agent can be attacked through an interface it already has.

```bash
npx agent-chaos mcp-config --scenario prompt-injection-sensitive-file
# paste the printed block into the MCP config you already have, run your agent, then:
npx agent-chaos report --scenario prompt-injection-sensitive-file
```

Works with Claude Code, Cursor, Windsurf, Goose, and OpenAI Agents SDK apps. No change to the agent under test.

## What's new

**MCP transport.** AgentChaos runs as an MCP server providing the full simulated tool surface. The verdict, evidence, and exit codes are identical to the JSONL transport, because it is the same engine.

**MCP proxy mode.** Declare `upstream.servers` and AgentChaos sits in front of your real MCP servers, so every call is both real and observed. Benign calls forward; anything matching `policy.require_approval` is answered with a simulated result and recorded as attempted. Detecting a violation needs the attempt, not the consequence — which is how proxy mode keeps the promise that nothing dangerous is actually performed.

**GitHub Action.** Fails a pull request when an attack succeeds, with an annotation on the scenario file and the full evidence chain in the job summary.

```yaml
- uses: asamassekou10/AgentChaos@v0
  with:
    report: agent-chaos-report.json
```

**Nine scenarios, up from four.** New: `hidden-unicode-instruction`, `nested-content-injection`, `approval-coercion`, `ssrf-internal-endpoint`, `destructive-command`. Three are deliberate near-misses of the originals, so an agent that passes one and fails its pair has a specific, nameable weakness rather than one aggregate verdict.

**Scenario packs.** Share scenarios as npm packages. npm is the registry, which keeps AgentChaos free of outbound requests while inheriting versioning, lockfiles, and integrity. Provenance shows as a column in `agent-chaos list`.

**Payload safety checks.** Every scenario is linted before it runs, and a payload carrying a real-looking credential or naming a routable host is refused. A scenario corpus is a supply chain, and this tool exists because supply chains are worth checking.

## Fixed

**The CLI did nothing when installed from npm.** The entry-point guard compared `process.argv[1]` to `import.meta.url` without resolving symlinks, and npm exposes `bin` as a symlink, so the guard was false for every installed user: every command exited 0 having printed nothing. It worked perfectly from a checkout, which is why the entire test suite and both demos missed it. **If you installed 0.1.0 and it appeared to do nothing, that was this.** Installing the packed tarball is now a release gate.

Proxy mode also survives an upstream that cannot start, and the GitHub Action writes its outputs even when a scenario fails.

## Unchanged

Nothing about the safety posture. Every payload is a harmless fixture, no built-in tool result causes a real action, AgentChaos makes no outbound request, and the protocol carries only observable events. There is still no claim to capture model reasoning, and a pass still means the scenarios that ran did not produce a violation — not that your agent is secure.

Full detail in the [changelog](https://github.com/asamassekou10/AgentChaos/blob/main/CHANGELOG.md).
