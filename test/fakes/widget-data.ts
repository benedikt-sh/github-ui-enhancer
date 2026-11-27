import type { DataResult, WidgetData } from '../../src/shared/data.ts';

type Method = keyof WidgetData;
type Handler<M extends Method> = (...args: Parameters<WidgetData[M]>) => ReturnType<WidgetData[M]>;

export interface RecordedCall {
  readonly method: Method;
  readonly args: readonly unknown[];
}

export interface FakeWidgetData extends WidgetData {
  readonly calls: readonly RecordedCall[];
  /** Replaces the answer of one method. Without a handler a method resolves an empty list. */
  handle<M extends Method>(method: M, handler: Handler<M>): FakeWidgetData;
  callsTo(method: Method): readonly (readonly unknown[])[];
}

export const FIXED_TIME = '2026-11-26T12:00:00.000Z';

export function dataResult<T>(data: T, overrides: Partial<DataResult<T>> = {}): DataResult<T> {
  return { data, errors: [], fetchedAt: FIXED_TIME, stale: false, ...overrides };
}

export function createFakeWidgetData(): FakeWidgetData {
  const calls: RecordedCall[] = [];
  const handlers = new Map<Method, (...args: unknown[]) => Promise<unknown>>();

  const call = <M extends Method>(method: M, args: unknown[]): Promise<never> => {
    calls.push({ method, args });
    const handler = handlers.get(method);
    const result = handler === undefined ? Promise.resolve(dataResult([])) : handler(...args);
    return result as Promise<never>;
  };

  const fake: FakeWidgetData = {
    calls,
    repoIndex: (...args) => call('repoIndex', args),
    searchPullRequests: (...args) => call('searchPullRequests', args),
    searchIssues: (...args) => call('searchIssues', args),
    subscribedIssues: (...args) => call('subscribedIssues', args),
    workflowRuns: (...args) => call('workflowRuns', args),
    branches: (...args) => call('branches', args),
    recentRepositories: (...args) => call('recentRepositories', args),
    handle(method, handler) {
      handlers.set(method, handler as unknown as (...args: unknown[]) => Promise<unknown>);
      return fake;
    },
    callsTo: (method) => calls.filter((entry) => entry.method === method).map((entry) => entry.args),
  };
  return fake;
}
