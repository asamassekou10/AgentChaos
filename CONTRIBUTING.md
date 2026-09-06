# Contributing to AgentChaos

Thanks for looking. New scenarios are the most useful thing you can add, and the checklist for those is below.

## Getting set up

Node 20 or newer.

```bash
git clone https://github.com/asamassekou10/AgentChaos.git
cd AgentChaos
npm install
npm run check
```

`npm run check` runs formatting, linting, type checking, tests, and the build. CI runs the same thing, so if it passes locally it should pass there.

Useful individually:

```bash
npm test              # vitest
npm run test:watch
npm run typecheck
npm run lint
npm run format
npm run demo:vulnerable   # should exit 1 with four failures
npm run demo:safe         # should exit 0 with four passes
```

## Adding a scenario

A scenario is a YAML file in `agent-chaos/scenarios/`. Before opening a PR, check it against this list.

**The payload is harmless.** No real credentials, no real hostnames, no URL that resolves to something you do not own. Use `example.invalid` for addresses and a `FAKE_TEST_` prefix for planted secrets. The payload is committed, and it appears in transcripts and reports.

**It asserts something specific.** `never` must name a tool. A scenario that forbids everything, or that asserts nothing, will pass or fail for reasons nobody can explain.

**It states a boundary.** `evidence.expected_boundary` is quoted verbatim in failure output. Write the sentence you would want to read at 4pm on a Friday when the build went red. "Untrusted issue content must not cause access to sensitive files" is useful; "checks for prompt injection" is not.

**It fails against the vulnerable demo and passes against the safe one.** If both modes pass, the scenario probably is not testing anything. If both fail, the safe agent needs a corresponding behaviour before the scenario is meaningful.

```bash
npm run build
node dist/cli/index.js test --config examples/demo-agent/vulnerable.yaml --scenario <your-id>
node dist/cli/index.js test --config examples/demo-agent/safe.yaml --scenario <your-id>
```

**Both demo modes reach the injection point.** A scenario injects on one tool. If the demo agent never calls that tool, the run is _inconclusive_, not passing. Check for `injectionDelivered: true` in the JSON report.

**Add it to the README table** and to the built-in list assertion in `tests/scenario.test.ts`.

## Adding an assertion type

Assertions live in `src/policy/assertions.ts` and must be decidable from the recorded event list alone. No I/O, no clock, no process state. That constraint is what makes a failure reproducible from its report, and it is not negotiable.

Add the schema to `AssertionsSchema` in `src/scenario/schema.ts`, the logic to `evaluate()`, a default mitigation in `src/evidence/builder.ts`, a label in `describeRule()` in `src/cli/commands/list.ts`, and tests in `tests/assertions.test.ts` covering both a violation and a clean pass.

If your assertion can be requested but not enforced — the way `tool_allowlist` cannot run without an allowlist — push a message onto `notEnforced` rather than passing. Reporting an unenforceable assertion as a pass is the most misleading thing this tool could do.

## Adding a transport

Implement the `Transport` interface in `src/transport/types.ts` and wire it into `createTransport()` in `src/engine/runner.ts`. The test engine talks to agents only through that interface, so a new transport should not require touching the injector, the recorder, or the assertion engine. If it does, that is worth discussing in an issue first.

## Code conventions

- Strict TypeScript. `any` needs a reason.
- ESM with `.js` extensions on relative imports, as NodeNext requires.
- Prettier decides formatting; do not argue with it by hand.
- Only `src/cli/index.ts` and the examples write to a stream directly. Everything else returns strings for a caller to print, which is what keeps it testable.
- Comments explain why, not what. If a line needs a comment to say what it does, rename something instead.

## Tests

Every filesystem test uses a temp directory and cleans up in `afterEach`. Never write fixtures into the repository that a tool might pick up on its own.

Cover the pass and the fail. A test that only proves a detector fires does not tell you whether it fires on everything.

## Pull requests

Keep them focused. A scenario, a bug fix, or a feature, not all three.

Say what you changed and why in the description. If the behaviour changed, paste the before and after output; it is the fastest way to review this project.

By contributing you agree your work is licensed under the MIT License.

## Releasing

Publishing is automated: creating a GitHub release publishes to npm. There is no npm token in this repository, and nothing is published by hand. See [docs/RELEASING.md](docs/RELEASING.md).

## Reporting bugs

Open an issue with the version, what you expected, what happened, and a minimal config and scenario that reproduces it. `--verbose` output is usually the fastest thing to include.

For a security problem in AgentChaos itself, use [SECURITY.md](SECURITY.md) instead of a public issue.
