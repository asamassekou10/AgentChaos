# Security Policy

## Reporting a vulnerability

Report vulnerabilities in AgentChaos itself through GitHub's private advisory form:

**https://github.com/asamassekou10/AgentChaos/security/advisories/new**

Please do not open a public issue for a security problem.

Include what you can: affected version, a description, reproduction steps, and what an attacker gains. A proof of concept helps but is not required to report.

You should get an acknowledgement within a week. This is a small open-source project maintained by volunteers, so please treat that as a good-faith target rather than a guarantee.

## What counts as a vulnerability here

AgentChaos runs on a developer's machine, reads configuration from a repository, and starts a process named in that configuration. The interesting question is what a **hostile repository** can do to someone who runs AgentChaos on it.

In scope:

- Anything in `agent-chaos.yaml` or a scenario file that causes code execution beyond starting the configured `agent.command` — shell injection, argument injection, path traversal out of the project.
- A scenario or config that causes AgentChaos to read or write files outside the paths it is meant to touch.
- Terminal escape sequences or control characters from a payload that reach a user's terminal unescaped.
- A crafted agent response that makes AgentChaos report a violation as a pass, or hide one. A false negative in a security test is a vulnerability in a security tool.
- Real secrets, host paths, or environment values leaking into a JSON report.
- Denial of service from a malformed payload: unbounded memory, a hang, or a crash loop.

Out of scope:

- Vulnerabilities in the agent you are testing. Finding those is what the tool is for; report them to that project.
- A scenario failing to detect an attack it does not describe. Write a scenario, or open a feature request.
- The fact that AgentChaos starts the process in `agent.command`. That is the documented purpose, and the config is expected to be as trusted as the code beside it.
- Advisories in development dependencies that do not reach the published `dist`.

## Design boundaries

These are deliberate properties, and a change that breaks one should be treated as a regression:

- **No shell.** `agent.command` is split on whitespace and passed as argv. AgentChaos never spawns a shell, so a config file cannot introduce a pipeline, a redirect, or a second command.
- **No network.** Nothing in the tool makes an outbound request. There is no telemetry, no update check, and no upload.
- **No real side effects.** Every built-in tool result is simulated and labelled. No built-in scenario reads a real file, writes a real file, or sends anything.
- **No real credentials.** `FAKE_TEST_SECRET_12345` is a fixture with no meaning outside these tests. No scenario should ever contain a value that is a credential anywhere.
- **No hidden reasoning.** The protocol carries observable events only. AgentChaos does not capture, infer, or claim to report a model's chain of thought.
- **No config discovery outside the working directory.** AgentChaos does not walk up the tree looking for a config file, so running it in a subdirectory cannot silently pick up a different project's policy.

## Safe use

- Point AgentChaos at an agent whose tools are simulated or sandboxed. It controls what the agent _reads_, not what the agent's own tools _do_.
- Run it in a temporary or disposable working directory when testing an agent with real filesystem access.
- Never put a real credential in a scenario file. Scenarios are committed, and the payload appears in the transcript.

## Supported versions

AgentChaos is pre-1.0. Fixes land on the latest minor release only.
