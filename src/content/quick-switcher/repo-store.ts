import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { RepoSearcher } from '../../lib/fuzzy.ts';
import type { DataResult, WidgetData } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RecentRepoItem, RepoActivityKind, RepoSummary } from '../../shared/types.ts';

/** Own code activity only, comments and reviews would list repositories one merely visited. */
export const RECENT_KINDS: readonly RepoActivityKind[] = ['push', 'pull_request', 'create'];
export const RECENT_LIMIT = 5;
/**
 * Minimum time between two loads. The background caches the data anyway, this only keeps
 * quick repeated openings from sending messages and rebuilding the search index.
 */
export const REFRESH_INTERVAL_MS = 60_000;

export interface LoadedRepoIndex {
  readonly repos: readonly RepoSummary[];
  readonly searcher: RepoSearcher;
  /** Partial failures, e.g. of one token, while other repositories loaded fine. */
  readonly errors: readonly ApiErrorInfo[];
  readonly fetchedAt: string;
}

export interface RepoStoreSnapshot {
  /** Null until the first load succeeded, kept when a later refresh fails. */
  readonly index: LoadedRepoIndex | null;
  /** Error of the latest load, null once a load succeeded. */
  readonly loadError: ApiErrorInfo | null;
  readonly loading: boolean;
  readonly recent: readonly RecentRepoItem[];
}

export interface RepoStoreOptions {
  readonly data: Pick<WidgetData, 'repoIndex' | 'recentRepositories'>;
  readonly now: () => number;
}

export interface RepoStore {
  snapshot(): RepoStoreSnapshot;
  /**
   * Loads on the first call. Later calls refresh in the background, at most once per
   * {@link REFRESH_INTERVAL_MS} unless the last load failed or `force` is set.
   */
  refresh(force?: boolean): void;
  /** Called after every change of the snapshot, returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Repositories and recent activity, kept in memory for the lifetime of the page. */
export function createRepoStore(options: RepoStoreOptions): RepoStore {
  const { data, now } = options;
  const listeners = new Set<() => void>();
  let snapshot: RepoStoreSnapshot = { index: null, loadError: null, loading: false, recent: [] };
  let indexLoadedAt: number | null = null;
  let recentLoadedAt: number | null = null;
  let recentLoading = false;

  function update(patch: Partial<RepoStoreSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function isDue(loadedAt: number | null, force: boolean): boolean {
    return force || loadedAt === null || now() - loadedAt >= REFRESH_INTERVAL_MS;
  }

  function loadIndex(force: boolean): void {
    if (snapshot.loading || !isDue(indexLoadedAt, force)) {
      return;
    }
    update({ loading: true });
    Promise.resolve()
      .then(() => data.repoIndex(force ? { forceRefresh: true } : undefined))
      .then(applyIndex, (error: unknown) => {
        indexLoadedAt = null;
        update({ loading: false, loadError: toApiErrorInfo(error) });
      });
  }

  function applyIndex(result: DataResult<RepoSummary[]>): void {
    indexLoadedAt = now();
    const previous = snapshot.index;
    // The same data comes back from the background cache on most refreshes, so the index
    // is only rebuilt when the repositories actually changed.
    const unchanged =
      previous !== null &&
      previous.fetchedAt === result.fetchedAt &&
      previous.repos.length === result.data.length;
    const searcher = unchanged ? previous.searcher : createRepoSearcher(result.data, { now });
    update({
      loading: false,
      loadError: null,
      index: {
        repos: unchanged ? previous.repos : result.data,
        searcher,
        errors: result.errors,
        fetchedAt: result.fetchedAt,
      },
    });
  }

  function loadRecent(force: boolean): void {
    if (recentLoading || !isDue(recentLoadedAt, force)) {
      return;
    }
    recentLoading = true;
    Promise.resolve()
      .then(() => data.recentRepositories({ kinds: RECENT_KINDS, limit: RECENT_LIMIT }))
      .then(
        (result) => {
          recentLoading = false;
          recentLoadedAt = now();
          update({ recent: result.data });
        },
        // Recent repositories are a convenience, the list simply starts without them.
        () => {
          recentLoading = false;
        },
      );
  }

  return {
    snapshot: () => snapshot,
    refresh(force = false) {
      loadIndex(force);
      loadRecent(force);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
