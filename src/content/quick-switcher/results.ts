import type { HighlightRange, RepoSearchResult } from '../../lib/fuzzy.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RecentRepoItem, RepoSummary, RepoVisibility } from '../../shared/types.ts';
import { safeUrl } from '../../ui/dom.ts';
import { repoUrl } from '../../ui/row.ts';
import type { LoadedRepoIndex, RepoStoreSnapshot } from './repo-store.ts';

export const MAX_RESULTS = 10;

export interface SwitcherEntry {
  /** Lower-cased full name, unique within one result list. */
  readonly key: string;
  readonly fullName: string;
  readonly url: string;
  readonly description: string | null;
  /** Null for recent repositories that are missing from the index. */
  readonly visibility: RepoVisibility | null;
  readonly archived: boolean;
  readonly fork: boolean;
  /** Ranges into `fullName`. */
  readonly nameHighlights: readonly HighlightRange[];
  /** Ranges into `description`. */
  readonly descriptionHighlights: readonly HighlightRange[];
  readonly recent: boolean;
}

export type ResultsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly errors: readonly ApiErrorInfo[] }
  | { readonly kind: 'no-tokens' }
  | { readonly kind: 'no-repos' }
  | { readonly kind: 'no-match'; readonly query: string };

export interface Results {
  readonly entries: readonly SwitcherEntry[];
  /** Shown instead of or below the entries, null when the entries say it all. */
  readonly state: ResultsState | null;
  /** Repositories some tokens could not load, while others loaded fine. */
  readonly partialErrors: readonly ApiErrorInfo[];
}

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

function fromSummary(repo: RepoSummary, recent: boolean): SwitcherEntry {
  return {
    key: repoKey(repo.owner, repo.name),
    fullName: repo.fullName,
    url: safeUrl(repo.url) ?? repoUrl(repo),
    description: repo.description,
    visibility: repo.visibility,
    archived: repo.archived,
    fork: repo.fork,
    nameHighlights: [],
    descriptionHighlights: [],
    recent,
  };
}

function fromSearchResult(result: RepoSearchResult): SwitcherEntry {
  return {
    ...fromSummary(result.repo, false),
    nameHighlights: result.highlights.fullName,
    descriptionHighlights: result.highlights.description,
  };
}

const reposByKey = new WeakMap<LoadedRepoIndex, ReadonlyMap<string, RepoSummary>>();

function findRepo(index: LoadedRepoIndex | null, key: string): RepoSummary | undefined {
  if (index === null) {
    return undefined;
  }
  let byKey = reposByKey.get(index);
  if (byKey === undefined) {
    byKey = new Map(index.repos.map((repo) => [repoKey(repo.owner, repo.name), repo]));
    reposByKey.set(index, byKey);
  }
  return byKey.get(key);
}

/** Recent activity can point to repositories no token covers, those keep what the event says. */
function fromRecent(item: RecentRepoItem, index: LoadedRepoIndex | null): SwitcherEntry {
  const key = repoKey(item.repo.owner, item.repo.name);
  const known = findRepo(index, key);
  if (known !== undefined) {
    return fromSummary(known, true);
  }
  return {
    key,
    fullName: `${item.repo.owner}/${item.repo.name}`,
    url: safeUrl(item.url) ?? repoUrl(item.repo),
    description: null,
    visibility: null,
    archived: false,
    fork: false,
    nameHighlights: [],
    descriptionHighlights: [],
    recent: true,
  };
}

/** Recent repositories first, then the most recently pushed ones. */
function startEntries(snapshot: RepoStoreSnapshot): SwitcherEntry[] {
  const { index } = snapshot;
  const entries = snapshot.recent.slice(0, MAX_RESULTS).map((item) => fromRecent(item, index));
  const seen = new Set(entries.map((entry) => entry.key));
  for (const result of index?.searcher.search('', { limit: MAX_RESULTS * 2 }) ?? []) {
    if (entries.length >= MAX_RESULTS) {
      break;
    }
    const entry = fromSummary(result.repo, false);
    if (!seen.has(entry.key)) {
      seen.add(entry.key);
      entries.push(entry);
    }
  }
  return entries;
}

function indexState(index: LoadedRepoIndex): ResultsState | null {
  if (index.repos.length > 0) {
    return null;
  }
  if (index.errors.some((error) => error.kind === 'no_tokens')) {
    return { kind: 'no-tokens' };
  }
  return index.errors.length > 0 ? { kind: 'error', errors: index.errors } : { kind: 'no-repos' };
}

/** What the switcher shows for `query` with the data loaded so far. */
export function buildResults(snapshot: RepoStoreSnapshot, query: string): Results {
  const { index } = snapshot;
  // A retry is running, the error of the previous attempt is no longer the news.
  const loadError = snapshot.loading ? null : snapshot.loadError;
  const trimmed = query.trim();
  if (index === null) {
    const state: ResultsState =
      loadError === null
        ? { kind: 'loading' }
        : loadError.kind === 'no_tokens'
          ? { kind: 'no-tokens' }
          : { kind: 'error', errors: [loadError] };
    // Recent repositories may arrive before the index and are useful right away.
    const entries = trimmed === '' && loadError === null ? startEntries(snapshot) : [];
    return { entries, state, partialErrors: [] };
  }

  const emptyIndex = indexState(index);
  if (emptyIndex !== null) {
    return { entries: [], state: emptyIndex, partialErrors: [] };
  }
  const entries =
    trimmed === ''
      ? startEntries(snapshot)
      : index.searcher
          .search(trimmed, { limit: MAX_RESULTS, includeArchived: true })
          .map(fromSearchResult);
  return {
    entries,
    state: entries.length === 0 ? { kind: 'no-match', query: trimmed } : null,
    partialErrors: index.errors,
  };
}
