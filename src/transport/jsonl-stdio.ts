/**
 * JSON Lines over a child process's stdin and stdout.
 *
 * The agent is spawned without a shell. Its `command` is split on whitespace
 * and passed as argv, so a command string cannot smuggle a pipeline, a
 * redirect, or a second command through the config file. AgentChaos reads
 * config from a repository, and a repository should not be able to run
 * arbitrary shell just by being tested.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { AgentSettings } from '../config/schema.js';
import type { HarnessMessage } from '../protocol/events.js';
import { LineBuffer, encodeLine, parseLine } from '../protocol/parse.js';
import type { Transport, TransportHandlers, TransportRunResult } from './types.js';

/** Split a command string into argv. Quoted segments stay together. */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(command)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  return parts.filter((part) => part !== '');
}

export class JsonlStdioTransport implements Transport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private closed = false;

  constructor(
    private readonly settings: AgentSettings,
    private readonly rootDir: string,
  ) {}

  send(message: HarnessMessage): void {
    if (!this.child || this.closed) return;
    if (!this.child.stdin.writable) return;
    this.child.stdin.write(encodeLine(message));
  }

  async run(handlers: TransportHandlers): Promise<TransportRunResult> {
    const argv = splitCommand(this.settings.command);
    const [executable, ...args] = argv;

    if (!executable) {
      return {
        reason: { kind: 'error', message: 'agent.command is empty after splitting' },
        stderr: '',
      };
    }

    const cwd = this.settings.cwd ? path.resolve(this.rootDir, this.settings.cwd) : this.rootDir;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executable, args, {
        cwd,
        env: { ...process.env, ...this.settings.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      return { reason: { kind: 'error', message: (error as Error).message }, stderr: '' };
    }

    this.child = child;

    return await new Promise<TransportRunResult>((resolve) => {
      const stdoutBuffer = new LineBuffer();
      let stderr = '';
      let settled = false;

      // A queue keeps handler execution ordered even when a handler is async.
      // Without it, two tool calls arriving in one chunk could have their
      // injected replies interleaved, and the recording would no longer match
      // what the agent actually saw.
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (work: () => void | Promise<void>): void => {
        queue = queue.then(work).catch((error: unknown) => {
          handlers.onStderr(`[agent-chaos] handler error: ${(error as Error).message}\n`);
        });
      };

      const finish = (result: TransportRunResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closed = true;
        // Let queued handlers drain so the recording is complete before the
        // engine evaluates it.
        void queue.then(() => {
          child.stdin.end();
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          resolve({ ...result, stderr });
        });
      };

      const timer = setTimeout(() => {
        finish({
          reason: { kind: 'timeout', afterMs: this.settings.timeout_ms },
          stderr,
        });
      }, this.settings.timeout_ms);

      const handleLine = (line: string): void => {
        const outcome = parseLine(line);
        if (outcome === null) return;

        if (!outcome.ok) {
          handlers.onParseFailure(outcome.failure);
          return;
        }

        const event = outcome.event;
        enqueue(async () => {
          await handlers.onEvent(event);
          if (event.type === 'final_output') {
            finish({ reason: { kind: 'final_output' }, stderr });
          }
        });
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        for (const line of stdoutBuffer.push(chunk)) handleLine(line);
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        handlers.onStderr(chunk);
      });

      // A broken pipe is normal when the agent exits while we are replying.
      child.stdin.on('error', () => {});

      child.on('error', (error) => {
        finish({ reason: { kind: 'error', message: error.message }, stderr });
      });

      child.on('close', (code, signal) => {
        for (const line of stdoutBuffer.flush()) handleLine(line);
        finish({ reason: { kind: 'exited', code, signal }, stderr });
      });
    });
  }
}
