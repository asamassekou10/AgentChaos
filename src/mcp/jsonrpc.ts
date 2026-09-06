/**
 * JSON-RPC 2.0 framing for MCP.
 *
 * Written rather than taken from the official SDK because the server half of
 * MCP is small and the SDK pulls express, hono, cors, jose, and ajv behind it.
 * Eleven transitive dependencies is a poor trade for a security tool, where the
 * install itself is part of what a user is trusting.
 *
 * This covers what a server needs: parse a request, answer it, and signal an
 * error in the shape a client expects. It is not a general JSON-RPC library and
 * does not try to be.
 */

import { z } from 'zod';

export const JSONRPC_VERSION = '2.0';

/** An id is a string or a number; a notification has none. */
export const RequestIdSchema = z.union([z.string(), z.number()]);
export type RequestId = z.infer<typeof RequestIdSchema>;

export const JsonRpcMessageSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: RequestIdSchema.optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

/**
 * The subset of JSON-RPC error codes this server can produce.
 * Values are fixed by the specification.
 */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export interface JsonRpcSuccess {
  jsonrpc: typeof JSONRPC_VERSION;
  id: RequestId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSONRPC_VERSION;
  id: RequestId;
  error: { code: number; message: string; data?: unknown };
}

export function success(id: RequestId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(id: RequestId, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

/**
 * Whether a message is a notification.
 *
 * A notification carries no id and must never be answered. Replying to one is
 * a protocol violation that some clients treat as fatal, so this distinction
 * is load-bearing rather than cosmetic.
 */
export function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined && typeof message.method === 'string';
}

export function isRequest(message: JsonRpcMessage): message is JsonRpcMessage & {
  id: RequestId;
  method: string;
} {
  return message.id !== undefined && typeof message.method === 'string';
}
