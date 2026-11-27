import { ApiError } from '../shared/errors.ts';
import type { ApiErrorInfo } from '../shared/errors.ts';
import type { Operation, Params, RequestSender, Result } from '../shared/messages.ts';
import type { TokenInfo } from '../shared/tokens.ts';

export type FakeHandlers = {
  [K in Operation]?: (params: Params<K>) => Result<K> | Promise<Result<K>>;
};

export interface SentRequest {
  readonly op: Operation;
  readonly params: unknown;
}

export interface FakeSender {
  readonly send: RequestSender;
  readonly calls: SentRequest[];
  /** Handlers can be replaced while a test runs. */
  readonly handlers: FakeHandlers;
  callsTo(op: Operation): unknown[];
}

/** Answers requests with the scripted handlers, unknown operations reject like the background. */
export function createFakeSender(handlers: FakeHandlers = {}): FakeSender {
  const calls: SentRequest[] = [];
  const send: RequestSender = async (op, params) => {
    calls.push({ op, params });
    const handler = handlers[op] as ((value: typeof params) => unknown) | undefined;
    if (handler === undefined) {
      throw new ApiError({ kind: 'internal', message: `No handler for "${op}".` });
    }
    return (await handler(params)) as Result<typeof op>;
  };
  return {
    send,
    calls,
    handlers,
    callsTo: (op) => calls.filter((call) => call.op === op).map((call) => call.params),
  };
}

export function rejectWith(info: ApiErrorInfo): () => Promise<never> {
  return () => Promise.reject(new ApiError(info));
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks and the DOM updates they trigger run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export const NOW = new Date('2026-11-26T12:00:00Z');

export function tokenInfo(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    id: 'token-1',
    owner: 'octo-org',
    ownerSource: 'detected',
    status: 'valid',
    login: 'octocat',
    expiresAt: '2027-06-01T12:00:00Z',
    lastCheckedAt: '2026-11-26T11:00:00Z',
    hint: 'abcd',
    ...overrides,
  };
}
