import type {
  ListOptions,
  RecentRepositoryOptions,
  RequestOptions,
  WorkflowRunOptions,
} from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import { isOneOf, isRecord, isString } from '../../shared/guards.ts';
import type { RequestHandlers } from '../../shared/messages.ts';
import { REPO_ACTIVITY_KINDS } from '../../shared/types.ts';
import type { RepoActivityKind, RepoRef } from '../../shared/types.ts';
import type { TokenRegistry } from '../tokens/token-registry.ts';
import { RUN_CONCLUSIONS, RUN_STATUSES } from './values.ts';
import type { DataLayer } from './widget-data.ts';

/** Far above any sensible search, low enough to keep junk out of cache keys. */
const MAX_QUERY_LENGTH = 1000;

export interface RequestHandlerOptions {
  readonly data: DataLayer;
  readonly registry: Pick<TokenRegistry, 'list' | 'add' | 'remove' | 'validate' | 'setOwner'>;
  readonly openOptionsPage: () => Promise<void>;
}

/*
 * Parameters cross the messaging boundary, so their types are only claims. Each handler checks
 * what it uses and refuses the request otherwise.
 */

function invalid(message: string): ApiError {
  return new ApiError({ kind: 'invalid_request', message });
}

function optionsRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw invalid('Options must be an object.');
  }
  return value;
}

function optional<T>(
  record: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => value is T,
): T | undefined {
  const value = record[key];
  if (value !== undefined && !guard(value)) {
    throw invalid(`Option "${key}" has the wrong type.`);
  }
  return value;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseRequestOptions(value: unknown): RequestOptions {
  const forceRefresh = optional(optionsRecord(value), 'forceRefresh', isBoolean);
  return forceRefresh === undefined ? {} : { forceRefresh };
}

export function parseListOptions(value: unknown): ListOptions {
  const limit = optional(optionsRecord(value), 'limit', isFiniteNumber);
  return { ...parseRequestOptions(value), ...(limit === undefined ? {} : { limit }) };
}

const RUN_FILTERS = [...RUN_STATUSES, ...RUN_CONCLUSIONS];

function isRunFilter(value: unknown): value is NonNullable<WorkflowRunOptions['status']> {
  return isOneOf(RUN_FILTERS, value);
}

function isActivityKinds(value: unknown): value is RepoActivityKind[] {
  return Array.isArray(value) && value.every((kind) => isOneOf(REPO_ACTIVITY_KINDS, kind));
}

export function parseWorkflowRunOptions(value: unknown): WorkflowRunOptions {
  const record = optionsRecord(value);
  const branch = optional(record, 'branch', isString);
  const status = optional(record, 'status', isRunFilter);
  return {
    ...parseListOptions(value),
    ...(branch === undefined ? {} : { branch }),
    ...(status === undefined ? {} : { status }),
  };
}

export function parseRecentRepositoryOptions(value: unknown): RecentRepositoryOptions {
  const kinds = optional(optionsRecord(value), 'kinds', isActivityKinds);
  return { ...parseListOptions(value), ...(kinds === undefined ? {} : { kinds }) };
}

export function parseRepo(value: unknown): RepoRef {
  if (!isRecord(value) || !isString(value['owner']) || !isString(value['name'])) {
    throw invalid('Repository must have an owner and a name.');
  }
  return { owner: value['owner'], name: value['name'] };
}

function parseQuery(value: unknown): string {
  if (!isString(value) || value.length > MAX_QUERY_LENGTH) {
    throw invalid(`Query must be a string of at most ${MAX_QUERY_LENGTH} characters.`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (!isString(value)) {
    throw invalid(`"${name}" must be a string.`);
  }
  return value;
}

export function createRequestHandlers(options: RequestHandlerOptions): RequestHandlers {
  const { data, registry } = options;

  /** Cached results belong to the old token set, mixing them with new ones would mislead. */
  async function afterTokenChange<T>(change: Promise<T>): Promise<T> {
    try {
      return await change;
    } finally {
      // Memory is cleared even if storage fails, which is all a correct answer needs.
      await data.clear().catch(() => undefined);
    }
  }

  // Every handler is async, so invalid parameters reject instead of throwing synchronously.
  return {
    'data.repoIndex': async (params) => data.repoIndex(parseRequestOptions(params.options)),
    'data.searchPullRequests': async (params) =>
      data.searchPullRequests(parseQuery(params.query), parseListOptions(params.options)),
    'data.searchIssues': async (params) =>
      data.searchIssues(parseQuery(params.query), parseListOptions(params.options)),
    'data.subscribedIssues': async (params) =>
      data.subscribedIssues(parseListOptions(params.options)),
    'data.workflowRuns': async (params) =>
      data.workflowRuns(parseRepo(params.repo), parseWorkflowRunOptions(params.options)),
    'data.branches': async (params) =>
      data.branches(parseRepo(params.repo), parseRequestOptions(params.options)),
    'data.recentRepositories': async (params) =>
      data.recentRepositories(parseRecentRepositoryOptions(params.options)),
    'tokens.summary': () => registry.list(),
    'tokens.list': () => registry.list(),
    'extension.openOptions': async () => {
      await options.openOptionsPage();
      return null;
    },
    'tokens.add': async (params) => {
      const secret = requireString(params.secret, 'secret');
      const owner = params.owner === undefined ? undefined : requireString(params.owner, 'owner');
      return afterTokenChange(registry.add(secret, owner));
    },
    'tokens.remove': async (params) => {
      await afterTokenChange(registry.remove(requireString(params.id, 'id')));
      return null;
    },
    'tokens.validate': async (params) =>
      afterTokenChange(registry.validate(requireString(params.id, 'id'))),
    'tokens.setOwner': async (params) => {
      const id = requireString(params.id, 'id');
      const owner = params.owner === null ? null : requireString(params.owner, 'owner');
      return afterTokenChange(registry.setOwner(id, owner));
    },
    'cache.clear': async () => {
      await data.clear();
      return null;
    },
  };
}
