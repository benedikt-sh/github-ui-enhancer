import { isNonEmptyString, isOneOf, isRecord, isString } from '../../shared/guards.ts';
import type {
  Actor,
  BranchItem,
  IssueItem,
  LabelInfo,
  PullRequestItem,
  RepoRef,
  RepoSummary,
  WorkflowRunItem,
} from '../../shared/types.ts';
import {
  CHECK_STATES,
  ISSUE_STATES,
  PULL_REQUEST_STATES,
  REPO_VISIBILITIES,
  REVIEW_DECISIONS,
  RUN_CONCLUSIONS,
  RUN_STATUSES,
  STATE_REASONS,
  isInteger,
} from './values.ts';

/*
 * Mappers return null for entries that lack required fields, so one odd entry does not cost
 * the whole list. Unknown enum values in optional fields become null instead, because GitHub
 * adds new values over time.
 */

type Json = Readonly<Record<string, unknown>>;

function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function stringOrNull(value: unknown): string | null {
  return isString(value) ? value : null;
}

function integerOr(value: unknown, fallback: number): number {
  return isInteger(value) ? value : fallback;
}

function lowerEnum<T extends string>(values: readonly T[], value: unknown): T | null {
  const lower = isString(value) ? value.toLowerCase() : null;
  return isOneOf(values, lower) ? lower : null;
}

function restActor(value: unknown): Actor | null {
  const user = record(value);
  const login = user['login'];
  if (!isNonEmptyString(login)) {
    return null;
  }
  return {
    login,
    avatarUrl: stringOrNull(user['avatar_url']) ?? '',
    url: stringOrNull(user['html_url']) ?? `https://github.com/${login}`,
  };
}

function graphQLActor(value: unknown): Actor | null {
  const actor = record(value);
  const login = actor['login'];
  if (!isNonEmptyString(login)) {
    return null;
  }
  return {
    login,
    avatarUrl: stringOrNull(actor['avatarUrl']) ?? '',
    url: stringOrNull(actor['url']) ?? `https://github.com/${login}`,
  };
}

function labels(value: unknown): LabelInfo[] {
  const list = Array.isArray(value) ? value : [];
  return list.flatMap((entry) => {
    const label = record(entry);
    const name = label['name'];
    return isNonEmptyString(name) ? [{ name, color: stringOrNull(label['color']) ?? '' }] : [];
  });
}

function actors(value: unknown, map: (entry: unknown) => Actor | null): Actor[] {
  const list = Array.isArray(value) ? value : [];
  return list.map(map).filter((actor) => actor !== null);
}

function nodes(connection: unknown): unknown[] {
  const list = record(connection)['nodes'];
  return Array.isArray(list) ? list : [];
}

function graphQLRepo(value: unknown): RepoRef | null {
  const repository = record(value);
  const owner = record(repository['owner'])['login'];
  const name = repository['name'];
  return isNonEmptyString(owner) && isNonEmptyString(name) ? { owner, name } : null;
}

const REPOSITORY_URL = /\/repos\/([^/]+)\/([^/]+)$/;

function restIssueRepo(issue: Json): RepoRef | null {
  const repository = record(issue['repository']);
  const owner = record(repository['owner'])['login'];
  const name = repository['name'];
  if (isNonEmptyString(owner) && isNonEmptyString(name)) {
    return { owner, name };
  }
  const match = REPOSITORY_URL.exec(stringOrNull(issue['repository_url']) ?? '');
  return match?.[1] !== undefined && match[2] !== undefined
    ? { owner: match[1], name: match[2] }
    : null;
}

export function mapRepo(value: unknown): RepoSummary | null {
  const repo = record(value);
  const { node_id: id, name, full_name: fullName, html_url: url } = repo;
  const owner = record(repo['owner'])['login'];
  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(owner) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(fullName) ||
    !isString(url)
  ) {
    return null;
  }
  return {
    id,
    owner,
    name,
    fullName,
    description: stringOrNull(repo['description']),
    visibility: isOneOf(REPO_VISIBILITIES, repo['visibility'])
      ? repo['visibility']
      : repo['private'] === true
        ? 'private'
        : 'public',
    archived: repo['archived'] === true,
    fork: repo['fork'] === true,
    defaultBranch: stringOrNull(repo['default_branch']) ?? '',
    pushedAt: stringOrNull(repo['pushed_at']),
    url,
  };
}

interface CommonFields {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: RepoRef;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function graphQLCommon(node: Json): CommonFields | null {
  const { id, number, title, url, createdAt, updatedAt } = node;
  const repo = graphQLRepo(node['repository']);
  if (
    !isNonEmptyString(id) ||
    !isInteger(number) ||
    !isString(title) ||
    !isString(url) ||
    !isString(createdAt) ||
    !isString(updatedAt) ||
    repo === null
  ) {
    return null;
  }
  return { id, number, title, url, repo, createdAt, updatedAt };
}

function lastCommitCheckState(commits: unknown): PullRequestItem['checkState'] {
  const last = nodes(commits).at(-1);
  const rollup = record(record(record(last)['commit'])['statusCheckRollup']);
  return lowerEnum(CHECK_STATES, rollup['state']);
}

export function mapPullRequestNode(value: unknown): PullRequestItem | null {
  const node = record(value);
  const common = graphQLCommon(node);
  const state = lowerEnum(PULL_REQUEST_STATES, node['state']);
  if (node['__typename'] !== 'PullRequest' || common === null || state === null) {
    return null;
  }
  return {
    ...common,
    author: graphQLActor(node['author']),
    state,
    isDraft: node['isDraft'] === true,
    reviewDecision: lowerEnum(REVIEW_DECISIONS, node['reviewDecision']),
    checkState: lastCommitCheckState(node['commits']),
    labels: labels(nodes(node['labels'])),
    commentCount: integerOr(record(node['comments'])['totalCount'], 0),
  };
}

export function mapIssueNode(value: unknown): IssueItem | null {
  const node = record(value);
  const common = graphQLCommon(node);
  const state = lowerEnum(ISSUE_STATES, node['state']);
  if (node['__typename'] !== 'Issue' || common === null || state === null) {
    return null;
  }
  return {
    ...common,
    author: graphQLActor(node['author']),
    state,
    stateReason: lowerEnum(STATE_REASONS, node['stateReason']),
    assignees: actors(nodes(node['assignees']), graphQLActor),
    labels: labels(nodes(node['labels'])),
    commentCount: integerOr(record(node['comments'])['totalCount'], 0),
  };
}

/** `GET /issues` lists pull requests as issues with a `pull_request` field. */
export function isRestPullRequest(value: unknown): boolean {
  return isRecord(value) && value['pull_request'] !== undefined && value['pull_request'] !== null;
}

export function mapRestIssue(value: unknown): IssueItem | null {
  const issue = record(value);
  const { node_id: id, number, title, html_url: url } = issue;
  const { created_at: createdAt, updated_at: updatedAt } = issue;
  const repo = restIssueRepo(issue);
  const state = lowerEnum(ISSUE_STATES, issue['state']);
  if (
    isRestPullRequest(issue) ||
    !isNonEmptyString(id) ||
    !isInteger(number) ||
    !isString(title) ||
    !isString(url) ||
    !isString(createdAt) ||
    !isString(updatedAt) ||
    repo === null ||
    state === null
  ) {
    return null;
  }
  return {
    id,
    number,
    title,
    url,
    repo,
    author: restActor(issue['user']),
    state,
    stateReason: lowerEnum(STATE_REASONS, issue['state_reason']),
    assignees: actors(issue['assignees'], restActor),
    labels: labels(issue['labels']),
    commentCount: integerOr(issue['comments'], 0),
    createdAt,
    updatedAt,
  };
}

export function mapWorkflowRun(value: unknown): WorkflowRunItem | null {
  const run = record(value);
  const { id, html_url: url, head_sha: headSha } = run;
  const { created_at: createdAt, updated_at: updatedAt } = run;
  if (
    !isInteger(id) ||
    !isString(url) ||
    !isString(headSha) ||
    !isString(createdAt) ||
    !isString(updatedAt)
  ) {
    return null;
  }
  const workflowName = stringOrNull(run['name']) ?? '';
  return {
    id,
    workflowName,
    displayTitle: stringOrNull(run['display_title']) ?? workflowName,
    runNumber: integerOr(run['run_number'], 0),
    runAttempt: integerOr(run['run_attempt'], 1),
    event: stringOrNull(run['event']) ?? '',
    // A run in a state this version does not know yet is still running in some form.
    status: lowerEnum(RUN_STATUSES, run['status']) ?? 'pending',
    conclusion: lowerEnum(RUN_CONCLUSIONS, run['conclusion']),
    branch: stringOrNull(run['head_branch']),
    headSha,
    actor: restActor(run['actor']) ?? restActor(run['triggering_actor']),
    url,
    createdAt,
    updatedAt,
    runStartedAt: stringOrNull(run['run_started_at']),
  };
}

export function mapBranch(value: unknown): BranchItem | null {
  const branch = record(value);
  const name = branch['name'];
  return isNonEmptyString(name) ? { name, protected: branch['protected'] === true } : null;
}

export function mapAll<T>(values: unknown, map: (value: unknown) => T | null): T[] {
  return (Array.isArray(values) ? values : []).map(map).filter((item) => item !== null);
}
