import type { ApiErrorInfo } from './errors.ts';
import type {
  BranchItem,
  IssueItem,
  PullRequestItem,
  RepoRef,
  RepoSummary,
  WorkflowRunItem,
} from './types.ts';

export interface RequestOptions {
  readonly forceRefresh?: boolean;
}

export interface ListOptions extends RequestOptions {
  readonly limit?: number;
}

export interface WorkflowRunOptions extends ListOptions {
  readonly branch?: string;
}

/**
 * Result of a data request. Requests fan out over several tokens, so a single broken token
 * yields partial `data` plus an entry in `errors` instead of a rejected promise.
 */
export interface DataResult<T> {
  readonly data: T;
  readonly errors: readonly ApiErrorInfo[];
  /** ISO 8601 time the data was fetched from GitHub, not when it was read from the cache. */
  readonly fetchedAt: string;
  /** True when served from an expired cache entry while a refresh is running or failed. */
  readonly stale: boolean;
}

/**
 * The only way widgets get GitHub data. Promises reject (with `ApiError`) only when the
 * request could not be processed at all, e.g. the background context is unreachable.
 */
export interface WidgetData {
  repoIndex(options?: RequestOptions): Promise<DataResult<RepoSummary[]>>;
  /** `query` uses GitHub search syntax without `is:pr`, which is added by the data layer. */
  searchPullRequests(query: string, options?: ListOptions): Promise<DataResult<PullRequestItem[]>>;
  /** `query` uses GitHub search syntax without `is:issue`, which is added by the data layer. */
  searchIssues(query: string, options?: ListOptions): Promise<DataResult<IssueItem[]>>;
  subscribedIssues(options?: ListOptions): Promise<DataResult<IssueItem[]>>;
  workflowRuns(repo: RepoRef, options?: WorkflowRunOptions): Promise<DataResult<WorkflowRunItem[]>>;
  branches(repo: RepoRef, options?: RequestOptions): Promise<DataResult<BranchItem[]>>;
}
