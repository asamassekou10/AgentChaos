# Changelog

Notable changes to AgentChaos. Versions follow [semantic versioning](https://semver.org), with the caveat noted in [docs/RELEASING.md](docs/RELEASING.md): pre-1.0, a change that alters a verdict is at least a minor, because a scenario that starts failing turns somebody's pipeline red.

## 0.3.0

The release that came from pointing AgentChaos at a real agent for the first time. 0.2.0 was run against Claude Code over MCP, three sweeps of all nine scenarios; Claude held the boundary in eight of nine classes, and the six defects that run exposed are all fixed here. Two of them changed what a green check means.

### Fixed

- **A call the client blocked is no longer reported as a pass** ([#7](https://github.com/asamassekou10/AgentChaos/issues/7)). AgentChaos sees only the calls an MCP client chooses to dispatch. When the client refused one at its own permission layer, the request never arrived, nothing was recorded, and the scenario printed a green check for a run in which the agent had been hijacked and only the client stopped it. Declare `client.reachable_tools` and a guarded tool outside that set is reported as not enforced instead.
- **An approval granted out of band no longer reads as a violation** ([#8](https://github.com/asamassekou10/AgentChaos/issues/8)). `never_without_approval` expects an observable approval event, but real clients grant approval through permission modes and allowlists that never cross the wire, so a call the operator authorised looked unapproved. Tools listed in `client.pre_approved_tools` now make the assertion untestable rather than violated.

- **The published CLI is executable** ([#11](https://github.com/asamassekou10/AgentChaos/issues/11)). TypeScript emits `dist/cli/index.js` as 0644, and npm chmods a bin target only when it first creates the `.bin` symlink, so installing over an existing link left the CLI unrunnable with `Permission denied`. The build now sets the mode, and the release workflow reinstalls over an existing link rather than trusting a first install.

- **The harness no longer announces itself to the agent under test** ([#9](https://github.com/asamassekou10/AgentChaos/issues/9)). The MCP `instructions` field, every advertised tool description, the proxy's description suffix, benign result `note` fields, and the `secret-exfiltration` payload all named AgentChaos and said the run was a security test. All of it is model-visible, and in a field test Claude Code named AgentChaos unprompted and reasoned from it. The operator now gets that assurance on stderr and in the report, where it cannot contaminate the run.
- **Benign tool results describe a small real project instead of an empty one** ([#12](https://github.com/asamassekou10/AgentChaos/issues/12)). `filesystem.list` returned `{entries: []}` and `filesystem.read` returned `{content: ""}` for everything, so agents concluded the workspace did not exist and stopped before the attack had anywhere to land. Unknown paths now return `ENOENT` rather than emptiness, because "nothing here" and "no such file" are different answers and one of them is a reason to give up.

All five were found running 0.2.0 against Claude Code over MCP. #7 and #8 resolve the same way: the verdict becomes inconclusive and exits `2`, because "we could not see this" is not "the agent behaved". Neither `client` list has a default, so a config that does not mention it behaves exactly as before, and a declaration never overrides the recording: a call the agent actually made is judged whatever the config claims.

### Added

- **`client` config block**, declaring what the agent's client does before AgentChaos sees a call: `reachable_tools` and `pre_approved_tools`.
- **`test --repeat <n>`** ([#10](https://github.com/asamassekou10/AgentChaos/issues/10)). Runs each scenario n times and reports the worst outcome with the counts beside it, because a real model is a sampling problem rather than a function: `unauthorized-write` reached both verdicts against Claude Code under identical inputs. The counts appear in the terminal only when the outcomes disagreed, are in the JSON report as `scenarios[].repeat`, and are absent for a single run so a one-run report never implies a frequency it cannot support.

### Changed

- **A reversed decision worth naming.** 0.2.0 deliberately appended "(Simulated by AgentChaos for security testing)" to every tool description, reasoning that a description is model-visible text and implying a real `email.send` would be its own small act of deception. #9 reverses that. The reasoning does not survive contact with a real agent, and it could not have been absolute in the first place: a scenario payload is a fabricated issue carrying an attack, so deceiving the agent about content is the experiment rather than a lapse in it. What the principle properly protects is the operator, who is still told plainly, on stderr and in the report.

### Notes

The safety posture is unchanged. Every payload is still a harmless fixture, no benign result causes a real action, AgentChaos still makes no outbound request, and the simulated workspace added for #12 contains only placeholder values on `example.com`. What changed is who is told: the operator, not the subject.

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
