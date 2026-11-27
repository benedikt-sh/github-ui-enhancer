import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { RecentRepoItem } from '../../shared/types.ts';
import type { RefreshReason, WidgetContext } from '../../shared/widget.ts';
import type { RecentReposConfig } from './recent-repos-config.ts';

export const NOW = new Date('2026-11-26T12:00:00Z');

export function recentRepo(overrides: Partial<RecentRepoItem> = {}): RecentRepoItem {
  return {
    repo: { owner: 'octo', name: 'repo' },
    url: 'https://github.com/octo/repo',
    lastActivityAt: '2026-11-26T11:00:00Z',
    lastActivity: 'push',
    branch: 'main',
    activityCount: 3,
    ...overrides,
  };
}

export function recentRepos(count: number): RecentRepoItem[] {
  return Array.from({ length: count }, (_, index) =>
    recentRepo({
      repo: { owner: 'octo', name: `repo-${index + 1}` },
      url: `https://github.com/octo/repo-${index + 1}`,
    }),
  );
}

export interface TestContext {
  readonly context: WidgetContext<RecentReposConfig>;
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
      instanceId: 'recent-repos-1',
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
