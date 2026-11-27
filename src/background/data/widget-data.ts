import type { DataResult, RequestOptions, WidgetData } from '../../shared/data.ts';
import { ApiError, type ApiErrorInfo, type ApiErrorKind, toApiErrorInfo } from '../../shared/errors.ts';
import { isRecord } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import type {
  BranchItem,
  IssueItem,
  PullRequestItem,
  RepoRef,
  RepoSummary,
  WorkflowRunItem,
} from '../../shared/types.ts';
import type { Cache, CacheEntry, CacheResult, LoadResult } from '../cache/cache.ts';
import type { GitHubClient, QueryParams } from '../github/types.ts';
import type { ActiveToken, TokenRegistry } from '../tokens/token-registry.ts';
import {
  mapAll,
  mapBranch,
  mapIssueNode,
  mapPullRequestNode,
  mapRepo,
  mapRestIssue,
  mapWorkflowRun,
} from './github-mapping.ts';
import { byNewest, clampLimit, mergeParts, type Part } from './merge.ts';
import type { SearchKind } from './queries.ts';
import { createSearchBatcher } from './search-batcher.ts';
import { scopeSearchQuery } from './search-scope.ts';
import {
  type CachedList,
  isBranchItem,
  isCachedListOf,
  isIssueItem,
  isPullRequestItem,
  isRepoSummary,
  isWorkflowRunItem,
} from './values.ts';

export const REPO_INDEX_TTL_MS = 60 * 60 * 1000;
export const REPO_INDEX_MAX_PAGES = 50;
export const SEARCH_TTL_MS = 60 * 1000;
export const SUBSCRIBED_TTL_MS = 60 * 1000;
export const WORKFLOW_RUNS_TTL_MS = 30 * 1000;
export const BRANCHES_TTL_MS = 5 * 60 * 1000;
export const BRANCHES_MAX_PAGES = 3;

const PER_PAGE = 100;
/** Bumped whenever the shape of cached values changes. */
const KEY_PREFIX = 'data:v1:';

/** Errors that only say this token cannot read the repository, so another one may. */
const ROUTING_MISSES: readonly ApiErrorKind[] = [
  'not_found',
  'forbidden',
  'sso_required',
  'unauthorized',
  'pending_approval',
];
/** Errors that tell the registry something about the token itself. */
const TOKEN_FAILURES: readonly ApiErrorKind[] = ['unauthorized', 'pending_approval'];

export interface DataLayerOptions {
  readonly client: GitHubClient;
  readonly cache: Cache;
  readonly registry: Pick<TokenRegistry, 'activeTokens' | 'tokenForOwner' | 'reportFailure'>;
  /** Epoch milliseconds, defaults to `Date.now`. */
  readonly now?: () => number;
  /** Decides when batched searches are sent, see `createSearchBatcher`. */
  readonly scheduleSearch?: (flush: () => void) => void;
}

export interface DataLayer extends WidgetData {
  /** Drops cached data and routing knowledge, e.g. after the set of tokens changed. */
  clear(): Promise<void>;
}

interface CachedFetch<T> {
  readonly key: string;
  /** Rate limit bucket the load spends from. */
  readonly bucket: 'core' | 'graphql';
  readonly ttl: number;
  readonly validate: (value: unknown) => value is CachedList<T>;
  readonly load: (previous: CacheEntry<CachedList<T>> | undefined) => Promise<
    LoadResult<CachedList<T>>
  >;
  readonly options: RequestOptions | undefined;
  readonly staleWhileRevalidate?: boolean;
}

interface TokenPart<T> extends Part<T> {
  readonly token: ActiveToken;
}

function cacheKey(kind: string, ...parts: readonly (string | number | null)[]): string {
  return `${KEY_PREFIX}${kind}:${JSON.stringify(parts)}`;
}

function loaded<T>(items: readonly T[], errors: readonly ApiErrorInfo[] = []) {
  return { status: 'loaded', value: { items, errors } } as const;
}

function invalidResponse(message: string): ApiError {
  return new ApiError({ kind: 'invalid_response', message });
}

function truncation(what: string, limit: number): ApiErrorInfo {
  return { kind: 'internal', message: `Only the first ${limit} ${what} were loaded.` };
}

function validRepo(repo: RepoRef): RepoRef {
  const parsed = parseRepoFullName(repoFullName(repo));
  if (parsed === null) {
    throw new ApiError({ kind: 'invalid_request', message: 'Invalid repository name.' });
  }
  return parsed;
}

function repoPath(repo: RepoRef, suffix: string): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}${suffix}`;
}

function routeKey(repo: RepoRef): string {
  return repoFullName(repo).toLowerCase();
}

export function createDataLayer(options: DataLayerOptions): DataLayer {
  const { client, cache, registry } = options;
  const now = options.now ?? Date.now;
  const batcher = createSearchBatcher({
    client,
    ...(options.scheduleSearch === undefined ? {} : { schedule: options.scheduleSearch }),
  });
  /** Which token listed a repository in the repo index or last read it successfully. */
  const routes = new Map<string, string>();

  const nowIso = (): string => new Date(now()).toISOString();

  function noTokens<T>(): DataResult<T[]> {
    return {
      data: [],
      errors: [{ kind: 'no_tokens', message: 'No valid GitHub token is configured.' }],
      fetchedAt: nowIso(),
      stale: false,
    };
  }

  /** Never lets a secret through, even if an error message should ever quote one. */
  function describe(error: unknown, owner: string | null, secrets: readonly string[]) {
    const info = toApiErrorInfo(error);
    const message = secrets.reduce(
      (text, secret) => text.split(secret).join('[redacted]'),
      info.message,
    );
    const withOwner = info.owner === undefined && owner !== null ? { owner } : {};
    return { ...info, message, ...withOwner };
  }

  async function reportFailure(token: ActiveToken, info: ApiErrorInfo): Promise<void> {
    if (TOKEN_FAILURES.includes(info.kind)) {
      // The token may have been removed meanwhile, which leaves nothing to update.
      await registry.reportFailure(token.id, info).catch(() => undefined);
    }
  }

  function exhaustedRateLimit(bucket: string): ApiErrorInfo | null {
    const snapshot = client.rateLimit(bucket);
    if (snapshot === null || snapshot.remaining > 0) {
      return null;
    }
    const waitMillis = Date.parse(snapshot.resetAt) - now();
    if (!(waitMillis > 0)) {
      return null;
    }
    return {
      kind: 'rate_limited',
      message: `GitHub ${bucket} rate limit is exhausted until ${snapshot.resetAt}.`,
      retryAfter: Math.ceil(waitMillis / 1000),
    };
  }

  /**
   * With an exhausted rate limit nothing is sent to GitHub: the load fails right away, so the
   * cache serves what it has as stale together with the `rate_limited` error.
   */
  function cachedFetch<T>(fetch: CachedFetch<T>): Promise<CacheResult<CachedList<T>>> {
    const limited = exhaustedRateLimit(fetch.bucket);
    return cache.get(fetch.key, {
      ttl: fetch.ttl,
      validate: fetch.validate,
      forceRefresh: fetch.options?.forceRefresh === true,
      staleWhileRevalidate: fetch.staleWhileRevalidate === true && limited === null,
      load: limited === null ? fetch.load : () => Promise.reject(new ApiError(limited)),
    });
  }

  async function activeTokens(): Promise<ActiveToken[]> {
    return registry.activeTokens();
  }

  async function fanOut<T>(
    tokens: readonly ActiveToken[],
    fetchFor: (token: ActiveToken) => CachedFetch<T>,
  ): Promise<TokenPart<T>[]> {
    const secrets = tokens.map((token) => token.secret);
    return Promise.all(
      tokens.map(async (token): Promise<TokenPart<T>> => {
        try {
          const result = await cachedFetch(fetchFor(token));
          const failure =
            result.error === undefined ? [] : [describe(result.error, token.owner, secrets)];
          for (const info of failure) {
            await reportFailure(token, info);
          }
          return {
            token,
            items: result.value.items,
            errors: [
              ...result.value.errors.map((info) => describe(info, token.owner, secrets)),
              ...failure,
            ],
            fetchedAt: result.fetchedAt,
            stale: result.stale,
          };
        } catch (error) {
          const info = describe(error, token.owner, secrets);
          await reportFailure(token, info);
          return { token, items: [], errors: [info], fetchedAt: null, stale: false };
        }
      }),
    );
  }

  async function conditionalGet<T>(
    secret: string,
    path: string,
    query: QueryParams,
    previous: CacheEntry<CachedList<T>> | undefined,
    parse: (data: unknown) => T[],
  ): Promise<LoadResult<CachedList<T>>> {
    const etag = previous?.meta['etag'];
    const result = await client.restGet(secret, path, {
      query,
      ...(etag === undefined ? {} : { etag }),
    });
    if (result.kind === 'not_modified') {
      return { status: 'not-modified', meta: { etag: result.etag } };
    }
    const meta = result.etag === null ? {} : { etag: result.etag };
    return { ...loaded(parse(result.data)), meta };
  }

  async function pagedList<T>(
    secret: string,
    path: string,
    query: QueryParams,
    maxPages: number,
    map: (value: unknown) => T | null,
    what: string,
  ): Promise<LoadResult<CachedList<T>>> {
    const result = await client.restGetPages(secret, path, {
      query: { ...query, per_page: PER_PAGE },
      maxPages,
    });
    if (!result.pages.every(Array.isArray)) {
      throw invalidResponse(`GitHub GET ${path} did not return a list.`);
    }
    const items = result.pages.flatMap((page) => mapAll(page, map));
    return loaded(items, result.truncated ? [truncation(what, maxPages * PER_PAGE)] : []);
  }

  async function search<T extends PullRequestItem | IssueItem>(
    kind: SearchKind,
    query: string,
    listOptions: { readonly limit?: number; readonly forceRefresh?: boolean } | undefined,
    map: (node: unknown) => T | null,
    guard: (value: unknown) => value is T,
  ): Promise<DataResult<T[]>> {
    const tokens = await activeTokens();
    if (tokens.length === 0) {
      return noTokens();
    }
    const limit = clampLimit(listOptions?.limit);
    const qualifier = kind === 'pullRequest' ? 'is:pr' : 'is:issue';
    const fullQuery = `${qualifier} ${query.trim()}`.trim();
    const parts = await fanOut<T>(tokens, (token) => {
      const tokenQuery = scopeSearchQuery(fullQuery, token, tokens);
      return {
        key: cacheKey('search', kind, token.id, limit, tokenQuery),
        bucket: 'graphql',
        ttl: SEARCH_TTL_MS,
        validate: isCachedListOf(guard),
        options: listOptions,
        load: async () => {
          const outcome = await batcher.search(token, { kind, query: tokenQuery, first: limit });
          return loaded(mapAll(outcome.nodes, map), outcome.errors);
        },
      };
    });
    return mergeParts(parts, {
      identify: (item) => item.id,
      compare: byNewest((item) => item.updatedAt),
      limit,
      now: nowIso(),
    });
  }

  /** The token of the repository owner, else the one that saw the repository, else all. */
  async function candidatesFor(repo: RepoRef, tokens: readonly ActiveToken[]) {
    const ownerToken = await registry.tokenForOwner(repo.owner);
    if (ownerToken !== null) {
      return [ownerToken];
    }
    const routed = tokens.find((token) => token.id === routes.get(routeKey(repo)));
    return routed === undefined ? tokens : [routed];
  }

  async function routedLoad<T>(
    repo: RepoRef,
    tokens: readonly ActiveToken[],
    attempt: (token: ActiveToken) => Promise<LoadResult<CachedList<T>>>,
  ): Promise<LoadResult<CachedList<T>>> {
    const candidates = await candidatesFor(repo, tokens);
    for (const token of candidates) {
      try {
        const result = await attempt(token);
        routes.set(routeKey(repo), token.id);
        return result;
      } catch (error) {
        const info = toApiErrorInfo(error);
        await reportFailure(token, info);
        if (candidates.length === 1 || !ROUTING_MISSES.includes(info.kind)) {
          throw error;
        }
      }
    }
    throw new ApiError({
      kind: 'no_token_for_owner',
      message: `No token can read ${repoFullName(repo)}. Add a token for ${repo.owner}.`,
      owner: repo.owner,
    });
  }

  async function repoScoped<T>(
    repo: RepoRef,
    tokens: readonly ActiveToken[],
    fetch: Omit<CachedFetch<T>, 'load' | 'bucket'>,
    attempt: (
      token: ActiveToken,
      previous: CacheEntry<CachedList<T>> | undefined,
    ) => Promise<LoadResult<CachedList<T>>>,
  ): Promise<DataResult<T[]>> {
    const secrets = tokens.map((token) => token.secret);
    try {
      const result = await cachedFetch<T>({
        ...fetch,
        bucket: 'core',
        load: (previous) => routedLoad(repo, tokens, (token) => attempt(token, previous)),
      });
      const errors: unknown[] = [...result.value.errors];
      if (result.error !== undefined) {
        errors.push(result.error);
      }
      return {
        data: [...result.value.items],
        errors: errors.map((error) => describe(error, repo.owner, secrets)),
        fetchedAt: result.fetchedAt,
        stale: result.stale,
      };
    } catch (error) {
      return {
        data: [],
        errors: [describe(error, repo.owner, secrets)],
        fetchedAt: nowIso(),
        stale: false,
      };
    }
  }

  return {
    async repoIndex(requestOptions) {
      const tokens = await activeTokens();
      if (tokens.length === 0) {
        return noTokens();
      }
      const parts = await fanOut<RepoSummary>(tokens, (token) => ({
        key: cacheKey('repos', token.id),
        bucket: 'core',
        ttl: REPO_INDEX_TTL_MS,
        validate: isCachedListOf(isRepoSummary),
        options: requestOptions,
        staleWhileRevalidate: true,
        load: () =>
          pagedList(
            token.secret,
            '/user/repos',
            { sort: 'pushed' },
            REPO_INDEX_MAX_PAGES,
            mapRepo,
            'repositories',
          ),
      }));
      for (const { token, items } of parts) {
        for (const repo of items) {
          routes.set(routeKey(repo), token.id);
        }
      }
      return mergeParts(parts, {
        identify: (repo) => repo.id,
        compare: byNewest((repo) => repo.pushedAt),
        now: nowIso(),
      });
    },

    searchPullRequests: (query, listOptions) =>
      search('pullRequest', query, listOptions, mapPullRequestNode, isPullRequestItem),

    searchIssues: (query, listOptions) =>
      search('issue', query, listOptions, mapIssueNode, isIssueItem),

    async subscribedIssues(listOptions) {
      const tokens = await activeTokens();
      if (tokens.length === 0) {
        return noTokens();
      }
      const limit = clampLimit(listOptions?.limit);
      const parts = await fanOut<IssueItem>(tokens, (token) => ({
        key: cacheKey('subscribed', token.id),
        bucket: 'core',
        ttl: SUBSCRIBED_TTL_MS,
        validate: isCachedListOf(isIssueItem),
        options: listOptions,
        load: (previous) =>
          conditionalGet(
            token.secret,
            '/issues',
            {
              filter: 'subscribed',
              state: 'open',
              sort: 'updated',
              direction: 'desc',
              per_page: PER_PAGE,
            },
            previous,
            (data) => {
              if (!Array.isArray(data)) {
                throw invalidResponse('GitHub GET /issues did not return a list.');
              }
              // Pull requests come back as issues as well and are dropped by the mapping.
              return mapAll(data, mapRestIssue);
            },
          ),
      }));
      return mergeParts(parts, {
        identify: (issue) => issue.id,
        compare: byNewest((issue) => issue.updatedAt),
        limit,
        now: nowIso(),
      });
    },

    async workflowRuns(repoInput, runOptions) {
      const repo = validRepo(repoInput);
      const tokens = await activeTokens();
      if (tokens.length === 0) {
        return noTokens();
      }
      const limit = clampLimit(runOptions?.limit);
      const branch = runOptions?.branch?.trim() || null;
      const path = repoPath(repo, '/actions/runs');
      const result = await repoScoped<WorkflowRunItem>(
        repo,
        tokens,
        {
          key: cacheKey('runs', routeKey(repo), branch, limit),
          ttl: WORKFLOW_RUNS_TTL_MS,
          validate: isCachedListOf(isWorkflowRunItem),
          options: runOptions,
        },
        (token, previous) =>
          conditionalGet(
            token.secret,
            path,
            { branch: branch ?? undefined, per_page: limit, exclude_pull_requests: true },
            previous,
            (data) => {
              const runs = isRecord(data) ? data['workflow_runs'] : undefined;
              if (!Array.isArray(runs)) {
                throw invalidResponse(`GitHub GET ${path} returned no workflow runs.`);
              }
              return mapAll(runs, mapWorkflowRun);
            },
          ),
      );
      return { ...result, data: result.data.slice(0, limit) };
    },

    async branches(repoInput, requestOptions) {
      const repo = validRepo(repoInput);
      const tokens = await activeTokens();
      if (tokens.length === 0) {
        return noTokens();
      }
      return repoScoped<BranchItem>(
        repo,
        tokens,
        {
          key: cacheKey('branches', routeKey(repo)),
          ttl: BRANCHES_TTL_MS,
          validate: isCachedListOf(isBranchItem),
          options: requestOptions,
        },
        (token) =>
          pagedList(
            token.secret,
            repoPath(repo, '/branches'),
            {},
            BRANCHES_MAX_PAGES,
            mapBranch,
            'branches',
          ),
      );
    },

    async clear() {
      routes.clear();
      await cache.clear();
    },
  };
}
