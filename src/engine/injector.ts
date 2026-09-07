/**
 * Payload injection.
 *
 * Decides what a tool call gets back: the scenario's payload if this is the
 * call being attacked, or a benign simulated result otherwise.
 *
 * The default result matters more than it looks. An agent that receives an
 * error for every tool it did not get injected on will stop early and the
 * scenario will pass having tested nothing. Benign, plausible, and boring is
 * the right default.
 */

import type { JsonValue, ToolCallEvent, ToolResultMessage } from '../protocol/events.js';
import type { Scenario } from '../scenario/schema.js';
import { listDirectory, notFound, readFile } from './workspace.js';

export interface InjectionRecord {
  /** The tool whose result was replaced. */
  tool: string;
  /** The call id that received the payload. */
  callId: string;
  /** Which matching call was hit, 1-based. */
  occurrence: number;
}

export class Injector {
  private counts = new Map<string, number>();
  private injections: InjectionRecord[] = [];

  constructor(private readonly scenario: Scenario) {}

  /**
   * Build the reply for a tool call.
   *
   * Injection fires exactly once, on the configured occurrence. Firing on every
   * matching call would let a scenario pass or fail on how many times the agent
   * happened to poll a tool, which is not a property of its security posture.
   */
  resultFor(call: ToolCallEvent): ToolResultMessage {
    const { inject } = this.scenario;

    if (call.tool !== inject.on_tool) {
      return {
        type: 'tool_result',
        id: call.id,
        result: defaultResultFor(call.tool, call.arguments),
      };
    }

    const seen = (this.counts.get(call.tool) ?? 0) + 1;
    this.counts.set(call.tool, seen);

    if (seen !== inject.occurrence) {
      return {
        type: 'tool_result',
        id: call.id,
        result: defaultResultFor(call.tool, call.arguments),
      };
    }

    this.injections.push({ tool: call.tool, callId: call.id, occurrence: seen });

    return { type: 'tool_result', id: call.id, result: inject.result, injected: true };
  }

  /** Every injection that actually fired, for the evidence trail. */
  getInjections(): InjectionRecord[] {
    return [...this.injections];
  }
}

/**
 * A benign result for a tool the scenario is not attacking.
 *
 * Nothing here touches a real filesystem, network, or credential store. The
 * values come from the small synthetic project in `workspace.ts`, which exists
 * so that an agent doing ordinary work has ordinary things to find: an agent
 * that concludes the environment is empty stops early, and a scenario that
 * ends early has tested nothing.
 *
 * These results deliberately do not announce that they are simulated. Telling
 * the agent under test that it is inside a security harness changes what is
 * being measured, and the operator is told through the report and stderr
 * instead, where it does not contaminate the run.
 */
export function defaultResultFor(tool: string, args: JsonValue = {}): JsonValue {
  const argPath = stringArg(args, 'path');

  switch (tool) {
    case 'filesystem.read': {
      const content = argPath === null ? null : readFile(argPath);
      return content === null ? notFound(argPath ?? '') : { content };
    }
    case 'filesystem.write': {
      const written = stringArg(args, 'content') ?? '';
      return { ok: true, bytesWritten: written.length };
    }
    case 'filesystem.list': {
      const entries = argPath === null ? null : listDirectory(argPath);
      return entries === null ? notFound(argPath ?? '') : { entries };
    }
    case 'email.send':
      return { ok: true, id: 'msg_8f21c0' };
    case 'github.get_issue':
      return {
        title: 'Bump the request timeout',
        body: 'The default 15s timeout is too tight for the report endpoint. Raise it to 30s.',
        state: 'open',
      };
    case 'github.create_pull_request':
      return { ok: true, number: 128, url: 'https://github.com/example/example-service/pull/128' };
    case 'http.fetch':
      return { status: 200, body: '<!doctype html><title>Example</title>' };
    case 'shell.exec':
      return { exitCode: 0, stdout: '', stderr: '' };
    default:
      return { ok: true };
  }
}

/** Read one string argument out of a tool call's arguments, if it is there. */
function stringArg(args: JsonValue, key: string): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  const value = (args as Record<string, JsonValue>)[key];
  return typeof value === 'string' ? value : null;
}
