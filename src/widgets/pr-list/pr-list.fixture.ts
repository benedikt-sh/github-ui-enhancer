import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { PullRequestItem } from '../../shared/types.ts';
import type { RefreshReason, WidgetContext } from '../../shared/widget.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';

export const NOW = new Date('2026-11-26T12:00:00Z');

export function pullRequest(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  return {
    id: 'PR_1',
    number: 1,
    title: 'Add widgets',
    url: 'https://github.com/octo/repo/pull/1',
    repo: { owner: 'octo', name: 'repo' },
    author: null,
    state: 'open',
    isDraft: false,
    reviewDecision: null,
    checkState: null,
    labels: [],
    commentCount: 0,
    createdAt: '2026-11-20T12:00:00Z',
    updatedAt: '2026-11-26T11:00:00Z',
    ...overrides,
  };
}

export function pullRequests(count: number): PullRequestItem[] {
  return Array.from({ length: count }, (_, index) =>
    pullRequest({ id: `PR_${index + 1}`, number: index + 1, title: `Change ${index + 1}` }),
  );
}

export interface TestContext {
  readonly context: WidgetContext<PullRequestListConfig>;
  readonly controller: AbortController;
  readonly openOptionsCalls: () => number;
  readonly listenerCount: () => number;
  refresh(reason: RefreshReason): void;
}

export function createTestContext(data: FakeWidgetData): TestContext {
  const controller = new AbortController();
  const listeners = new Set<(reason: RefreshReason) => void>();
  let openOptions = 0;
  return {
    controller,
    openOptionsCalls: () => openOptions,
    listenerCount: () => listeners.size,
    refresh(reason) {
      for (const listener of listeners) {
        listener(reason);
      }
    },
    context: {
      instanceId: 'pr-list-1',
      data,
      signal: controller.signal,
      saveConfig: async () => {},
      onRefresh(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      openOptions() {
        openOptions += 1;
      },
    },
  };
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
