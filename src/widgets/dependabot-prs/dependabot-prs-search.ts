import type { DataResult, WidgetData } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import { repoFullName } from '../../shared/repo.ts';
import type { PullRequestItem, RepoRef } from '../../shared/types.ts';

/**
 * GitHub search sorts by relevance by default. Each chunk returns only `limit` items, so they
 * have to be the newest ones for the merged list to be the newest overall.
 */
export const DEPENDABOT_QUERY = 'is:open archived:false author:app/dependabot sort:updated-desc';

/** GitHub rejects search queries longer than this. */
export const MAX_QUERY_LENGTH = 256;

/** Prepended by the data layer. */
export const DATA_LAYER_PREFIX = 'is:pr ';

/**
 * The data layer limits searches of an org token to its org by appending ` org:<owner>`.
 * Logins have at most 39 characters.
 */
export const SCOPE_RESERVE = ' org:'.length + 39;

export function dependabotQuery(repos: readonly RepoRef[]): string {
  return [DEPENDABOT_QUERY, ...repos.map((repo) => `repo:${repoFullName(repo)}`)].join(' ');
}

/** Length of the query as GitHub receives it in the worst case. */
export function sentQueryLength(repos: readonly RepoRef[]): number {
  return DATA_LAYER_PREFIX.length + dependabotQuery(repos).length + SCOPE_RESERVE;
}

/**
 * Splits the repos greedily, in order, into chunks whose query stays below
 * {@link MAX_QUERY_LENGTH}. A repo that does not fit even alone still gets its own chunk.
 */
export function chunkRepos(
  repos: readonly RepoRef[],
  maxLength = MAX_QUERY_LENGTH,
): RepoRef[][] {
  const chunks: RepoRef[][] = [];
  let current: RepoRef[] = [];
  for (const repo of repos) {
    const candidate = [...current, repo];
    if (current.length > 0 && sentQueryLength(candidate) >= maxLength) {
      chunks.push(current);
      current = [repo];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function dependabotSearchUrl(repos: readonly RepoRef[]): string {
  const query = `${DATA_LAYER_PREFIX}${dependabotQuery(repos)}`;
  return `https://github.com/pulls?q=${encodeURIComponent(query)}`;
}

export interface DependabotSearchOptions {
  readonly limit: number;
  readonly forceRefresh: boolean;
  /** Fetch time reported when there is nothing to fetch. */
  readonly now: () => Date;
}

function newestFirst(a: PullRequestItem, b: PullRequestItem): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function merge(
  results: readonly DataResult<PullRequestItem[]>[],
  errors: readonly ApiErrorInfo[],
  limit: number,
): DataResult<PullRequestItem[]> {
  const byId = new Map<string, PullRequestItem>();
  for (const item of results.flatMap((result) => result.data)) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  // The merged data is as old as its oldest part.
  const fetchedAt = results
    .map((result) => result.fetchedAt)
    .reduce((oldest, value) => (Date.parse(value) < Date.parse(oldest) ? value : oldest));
  return {
    data: [...byId.values()].sort(newestFirst).slice(0, limit),
    errors: [...results.flatMap((result) => result.errors), ...errors],
    fetchedAt,
    stale: results.some((result) => result.stale),
  };
}

/**
 * Searches all chunks at once, so the data layer can batch them into one request per token.
 * Rejects only when every chunk was rejected, otherwise failed chunks become errors.
 */
export async function searchDependabotPullRequests(
  data: WidgetData,
  repos: readonly RepoRef[],
  options: DependabotSearchOptions,
): Promise<DataResult<PullRequestItem[]>> {
  const chunks = chunkRepos(repos);
  if (chunks.length === 0) {
    return { data: [], errors: [], fetchedAt: options.now().toISOString(), stale: false };
  }
  const requestOptions = { limit: options.limit, forceRefresh: options.forceRefresh };
  const settled = await Promise.allSettled(
    chunks.map((chunk) => data.searchPullRequests(dependabotQuery(chunk), requestOptions)),
  );
  const results: DataResult<PullRequestItem[]>[] = [];
  const failures: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      failures.push(outcome.reason);
    }
  }
  if (results.length === 0) {
    throw failures[0];
  }
  return merge(results, failures.map(toApiErrorInfo), options.limit);
}
