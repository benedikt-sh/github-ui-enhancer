import { FIXED_TIME } from '../../../test/fakes/widget-data.ts';
import type { RecentRepoItem, RepoSummary } from '../../shared/types.ts';

export const NOW = Date.parse(FIXED_TIME) + 5 * 60_000;

export function repo(fullName: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id: `R_${fullName}`,
    owner,
    name,
    fullName,
    description: null,
    visibility: 'public',
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: '2026-11-20T12:00:00.000Z',
    url: `https://github.com/${fullName}`,
    ...overrides,
  };
}

export function recentItem(fullName: string, url?: string): RecentRepoItem {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    repo: { owner, name },
    url: url ?? `https://github.com/${fullName}`,
    lastActivityAt: '2026-11-25T00:00:00Z',
    lastActivity: 'push',
    branch: 'main',
    activityCount: 3,
  };
}

/** `acme/billing-api` was pushed most recently, `acme/old-billing` is archived. */
export const REPOS: readonly RepoSummary[] = [
  repo('acme/billing-api', {
    description: 'Handles invoices',
    visibility: 'private',
    pushedAt: FIXED_TIME,
  }),
  repo('acme/web', { pushedAt: '2026-11-20T12:00:00.000Z' }),
  repo('globex/billing-ui', { visibility: 'internal', pushedAt: '2026-11-10T12:00:00.000Z' }),
  repo('acme/old-billing', { archived: true, pushedAt: '2026-01-01T12:00:00.000Z' }),
  repo('octo/forked', { fork: true, pushedAt: null }),
];

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}
