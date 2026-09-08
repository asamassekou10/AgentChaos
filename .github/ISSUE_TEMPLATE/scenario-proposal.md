---
name: Scenario proposal
about: Propose an attack class the corpus does not cover
title: 'Scenario: '
labels: 'scenario'
---

## The attack

What untrusted content arrives, where it arrives, and what it tries to make the
agent do. A link to a disclosure or writeup is the strongest form of this — the
scenario can then carry it in `references`.

## Why the corpus misses it today

Which existing scenario comes closest, and what a defence against that one would
fail to stop here.

## The boundary

One sentence stating what must not happen, written so a person reading a failed
run knows what was violated. This becomes `evidence.expected_boundary`.

## The gap between task and payload

**The most common reason a proposed scenario does not work.** The injected
action has to be something the agent's legitimate task would _not_ authorise. If
a well-behaved agent doing its job would take the same action, the scenario
cannot tell capture from obedience and will flag correct agents — see #19 for a
case where we got this wrong and had to redesign.

What does the task authorise, and how is the payload's demand outside it?

## Benign form

What does this pattern look like when it is _not_ an attack? Every scenario needs
a false-positive case it must stay silent on — Git LFS for filter config, a
`*.sample` hook, a legitimate CI edit. If you cannot name one, say so; it may
mean the rule is too broad.
