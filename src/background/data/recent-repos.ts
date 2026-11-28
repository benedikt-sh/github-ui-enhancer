import { isNonEmptyString, isOneOf, isRecord, isString } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import { REPO_ACTIVITY_KINDS } from '../../shared/types.ts';
import type {
  RecentRepoItem,
  RepoActivityKind,
  RepoRef,
  RepoSummary,
} from '../../shared/types.ts';
import { byNewest } from './merge.ts';
import { isRepoRef } from './values.ts';

/** Repositories pushed to longer ago are not asked for their events. */
export const EVENT_CANDIDATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const EVENT_CANDIDATE_LIMIT = 20;

/** One event, reduced to what the recent repositories need. */
export interface RecentEvent {
  readonly id: string;
  /** Login of the user who caused the event, null if GitHub sent none. */
  readonly actor: string | null;
  readonly repo: RepoRef;
  readonly kind: RepoActivityKind;
  readonly branch: string | null;
  readonly createdAt: string;
}

const EVENT_KINDS: Readonly<Record<string, RepoActivityKind>> = {
  PushEvent: 'push',
  PullRequestEvent: 'pull_request',
  PullRequestReviewEvent: 'review',
  PullRequestReviewCommentEvent: 'review',
  PullRequestReviewThreadEvent: 'review',
  IssuesEvent: 'issue',
  IssueCommentEvent: 'comment',
  CommitCommentEvent: 'comment',
  CreateEvent: 'create',
  ReleaseEvent: 'release',
};

const BRANCH_REF = 'refs/heads/';

function eventBranch(kind: RepoActivityKind, payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const ref = payload['ref'];
  if (kind === 'push' && isString(ref) && ref.startsWith(BRANCH_REF)) {
    return ref.slice(BRANCH_REF.length);
  }
  if (kind === 'create' && payload['ref_type'] === 'branch' && isNonEmptyString(ref)) {
    return ref;
  }
  return null;
}

function actorLogin(actor: unknown): string | null {
  const login = isRecord(actor) ? actor['login'] : undefined;
  return isNonEmptyString(login) ? login : null;
}

/**
 * Maps an entry of `GET /users/{login}/events` or `GET /repos/{owner}/{repo}/events`, null for
 * anything unusable.
 */
export function mapEvent(value: unknown): RecentEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, type, created_at: createdAt, actor, repo, payload } = value;
  const name = isRecord(repo) ? repo['name'] : undefined;
  const ref = isString(name) ? parseRepoFullName(name) : null;
  if (!isNonEmptyString(id) || !isString(createdAt) || ref === null) {
    return null;
  }
  const kind = (isString(type) ? EVENT_KINDS[type] : undefined) ?? 'other';
  const branch = eventBranch(kind, payload);
  return { id, actor: actorLogin(actor), repo: ref, kind, branch, createdAt };
}

export function isRecentEvent(value: unknown): value is RecentEvent {
  return (
    isRecord(value) &&
    isNonEmptyString(value['id']) &&
    (value['actor'] === null || isNonEmptyString(value['actor'])) &&
    isRepoRef(value['repo']) &&
    isOneOf(REPO_ACTIVITY_KINDS, value['kind']) &&
    (value['branch'] === null || isString(value['branch'])) &&
    isString(value['createdAt'])
  );
}

/**
 * Repositories whose own events are read in addition to the user's events: the most recently
 * pushed ones that are not public. For fine-grained tokens the user's events contain only public
 * activity, which already covers public repositories.
 */
export function selectEventCandidates(repos: readonly RepoSummary[], now: number): RepoRef[] {
  const since = now - EVENT_CANDIDATE_MAX_AGE_MS;
  return repos
    .filter(
      (repo) =>
        repo.visibility !== 'public' &&
        repo.pushedAt !== null &&
        Date.parse(repo.pushedAt) >= since,
    )
    .sort(byNewest((repo) => repo.pushedAt))
    .slice(0, EVENT_CANDIDATE_LIMIT)
    .map(({ owner, name }) => ({ owner, name }));
}

/** Events caused by one of the given logins, compared case-insensitively. */
export function ownEvents(
  events: readonly RecentEvent[],
  logins: readonly string[],
): RecentEvent[] {
  const own = new Set(logins.map((login) => login.toLowerCase()));
  return events.filter((event) => event.actor !== null && own.has(event.actor.toLowerCase()));
}

/**
 * Groups events (newest first) by repository. The newest event decides the shown activity, all
 * matching events count. Repository names are compared case-insensitively.
 */
export function aggregateRecentRepos(
  events: readonly RecentEvent[],
  kinds: readonly RepoActivityKind[] | undefined,
  limit: number,
): RecentRepoItem[] {
  const byRepo = new Map<string, { item: RecentRepoItem; count: number }>();
  for (const event of events) {
    if (kinds !== undefined && !kinds.includes(event.kind)) {
      continue;
    }
    const key = repoFullName(event.repo).toLowerCase();
    const known = byRepo.get(key);
    if (known === undefined) {
      byRepo.set(key, {
        count: 1,
        item: {
          repo: event.repo,
          url: `https://github.com/${repoFullName(event.repo)}`,
          lastActivityAt: event.createdAt,
          lastActivity: event.kind,
          branch: event.branch,
          activityCount: 1,
        },
      });
    } else {
      known.count += 1;
    }
  }
  return [...byRepo.values()]
    .map(({ item, count }) => ({ ...item, activityCount: count }))
    .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
    .slice(0, limit);
}
