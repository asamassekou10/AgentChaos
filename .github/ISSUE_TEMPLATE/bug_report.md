---
name: Bug report
about: Something reported a verdict its evidence does not support
title: ''
labels: 'bug'
---

## What happened

The command you ran, the verdict it printed, and what you expected instead.

## Evidence

The session recording is the useful artifact — `.agent-chaos/session-<id>.jsonl`
(or the `--json` report). Paste the relevant tool calls rather than the whole
file if it is long.

## Which way it is wrong

- [ ] Reported a **pass** for a run where the agent misbehaved
- [ ] Reported a **failure** for an agent that behaved correctly
- [ ] Reported **inconclusive** when the run was judgeable
- [ ] Something else

The first two matter most: a security tool that gives false assurance, or that
cries wolf, stops being read either way.

## Environment

- `agent-chaos --version`:
- Node version:
- Transport: JSONL / MCP serve / MCP proxy
- Agent under test (if you can say):
