import { type ApiErrorInfo, isApiErrorInfo } from '../../shared/errors.ts';
import { isNonEmptyString, isOneOf, isRecord, isString } from '../../shared/guards.ts';
import type {
  Actor,
  BranchItem,
  CheckState,
  IssueItem,
  LabelInfo,
  PullRequestItem,
  RepoRef,
  RepoSummary,
  RepoVisibility,
  ReviewDecision,
  WorkflowRunConclusion,
  WorkflowRunItem,
  WorkflowRunStatus,
} from '../../shared/types.ts';

export const REPO_VISIBILITIES: readonly RepoVisibility[] = ['public', 'private', 'internal'];
export const REVIEW_DECISIONS: readonly ReviewDecision[] = [
  'approved',
  'changes_requested',
  'review_required',
];
export const CHECK_STATES: readonly CheckState[] = [
  'success',
  'failure',
  'pending',
  'error',
  'expected',
];
export const PULL_REQUEST_STATES: readonly PullRequestItem['state'][] = [
  'open',
  'closed',
  'merged',
];
export const ISSUE_STATES: readonly IssueItem['state'][] = ['open', 'closed'];
export const STATE_REASONS: readonly NonNullable<IssueItem['stateReason']>[] = [
  'completed',
  'not_planned',
  'reopened',
  'duplicate',
];
export const RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'requested',
  'pending',
];
export const RUN_CONCLUSIONS: readonly WorkflowRunConclusion[] = [
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
];

type Guard<T> = (value: unknown) => value is T;

export function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

export function isArrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

function isEnum<T extends string>(values: readonly T[]): Guard<T> {
  return (value): value is T => isOneOf(values, value);
}

export function isActor(value: unknown): value is Actor {
  return (
    isRecord(value) &&
    isNonEmptyString(value['login']) &&
    isString(value['avatarUrl']) &&
    isString(value['url'])
  );
}

export function isLabel(value: unknown): value is LabelInfo {
  return isRecord(value) && isString(value['name']) && isString(value['color']);
}

export function isRepoRef(value: unknown): value is RepoRef {
  return isRecord(value) && isNonEmptyString(value['owner']) && isNonEmptyString(value['name']);
}

export function isRepoSummary(value: unknown): value is RepoSummary {
  return (
    isRepoRef(value) &&
    isRecord(value) &&
    isNonEmptyString(value['id']) &&
    isNonEmptyString(value['fullName']) &&
    isNullable(isString)(value['description']) &&
    isOneOf(REPO_VISIBILITIES, value['visibility']) &&
    isBoolean(value['archived']) &&
    isBoolean(value['fork']) &&
    isString(value['defaultBranch']) &&
    isNullable(isString)(value['pushedAt']) &&
    isString(value['url'])
  );
}

interface ListItemFields {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: RepoRef;
  readonly author: Actor | null;
  readonly labels: readonly LabelInfo[];
  readonly commentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function hasListItemFields(value: unknown): value is ListItemFields {
  return (
    isRecord(value) &&
    isNonEmptyString(value['id']) &&
    isInteger(value['number']) &&
    isString(value['title']) &&
    isString(value['url']) &&
    isRepoRef(value['repo']) &&
    isNullable(isActor)(value['author']) &&
    isArrayOf(isLabel)(value['labels']) &&
    isInteger(value['commentCount']) &&
    isString(value['createdAt']) &&
    isString(value['updatedAt'])
  );
}

export function isPullRequestItem(value: unknown): value is PullRequestItem {
  return (
    hasListItemFields(value) &&
    isRecord(value) &&
    isOneOf(PULL_REQUEST_STATES, value['state']) &&
    isBoolean(value['isDraft']) &&
    isNullable(isEnum(REVIEW_DECISIONS))(value['reviewDecision']) &&
    isNullable(isEnum(CHECK_STATES))(value['checkState'])
  );
}

export function isIssueItem(value: unknown): value is IssueItem {
  return (
    hasListItemFields(value) &&
    isRecord(value) &&
    isOneOf(ISSUE_STATES, value['state']) &&
    isNullable(isEnum(STATE_REASONS))(value['stateReason']) &&
    isArrayOf(isActor)(value['assignees'])
  );
}

export function isWorkflowRunItem(value: unknown): value is WorkflowRunItem {
  return (
    isRecord(value) &&
    isInteger(value['id']) &&
    isString(value['workflowName']) &&
    isString(value['displayTitle']) &&
    isInteger(value['runNumber']) &&
    isInteger(value['runAttempt']) &&
    isString(value['event']) &&
    isOneOf(RUN_STATUSES, value['status']) &&
    isNullable(isEnum(RUN_CONCLUSIONS))(value['conclusion']) &&
    isNullable(isString)(value['branch']) &&
    isString(value['headSha']) &&
    isNullable(isActor)(value['actor']) &&
    isString(value['url']) &&
    isString(value['createdAt']) &&
    isString(value['updatedAt']) &&
    isNullable(isString)(value['runStartedAt'])
  );
}

export function isBranchItem(value: unknown): value is BranchItem {
  return isRecord(value) && isNonEmptyString(value['name']) && isBoolean(value['protected']);
}

/**
 * What one token contributed to a list, as cached. `errors` keeps problems that did not stop
 * the request, e.g. a page cap or hidden SAML protected results, so cache hits report them too.
 */
export interface CachedList<T> {
  readonly items: readonly T[];
  readonly errors: readonly ApiErrorInfo[];
}

export function isCachedListOf<T>(guard: Guard<T>): Guard<CachedList<T>> {
  return (value): value is CachedList<T> =>
    isRecord(value) &&
    isArrayOf(guard)(value['items']) &&
    isArrayOf(isApiErrorInfo)(value['errors']);
}
