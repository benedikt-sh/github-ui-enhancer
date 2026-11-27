import { isRecord, isString } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import type { RepoRef } from '../../shared/types.ts';
import { repoUrl } from '../../ui/row.ts';

export const RUN_LIMITS = [5, 10, 20] as const;

export type RunLimit = (typeof RUN_LIMITS)[number];

export const DEFAULT_RUN_LIMIT: RunLimit = 10;

export const RUN_STATUS_FILTERS = ['all', 'failure'] as const;

export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export const RUN_STATUS_FILTER_LABELS: Record<RunStatusFilter, string> = {
  all: 'All runs',
  failure: 'Failed runs',
};

export interface ActionsRunsConfig {
  readonly repo: RepoRef | null;
  /** Null shows runs of all branches. */
  readonly branch: string | null;
  readonly limit: RunLimit;
  readonly status: RunStatusFilter;
  /** Null uses the generated title. */
  readonly title: string | null;
}

export function defaultActionsRunsConfig(): ActionsRunsConfig {
  return { repo: null, branch: null, limit: DEFAULT_RUN_LIMIT, status: 'all', title: null };
}

function parseRepo(value: unknown): RepoRef | null {
  if (isString(value)) {
    return parseRepoFullName(value);
  }
  if (isRecord(value) && isString(value['owner']) && isString(value['name'])) {
    return parseRepoFullName(`${value['owner']}/${value['name']}`);
  }
  return null;
}

function parseText(value: unknown): string | null {
  if (!isString(value)) {
    return null;
  }
  const text = value.trim();
  return text === '' ? null : text;
}

export function isRunLimit(value: unknown): value is RunLimit {
  return RUN_LIMITS.some((limit) => limit === value);
}

export function isRunStatusFilter(value: unknown): value is RunStatusFilter {
  return RUN_STATUS_FILTERS.some((filter) => filter === value);
}

/** Configs stored before the status filter existed have no `status` and show all runs. */
export function parseActionsRunsConfig(raw: unknown): ActionsRunsConfig {
  const defaults = defaultActionsRunsConfig();
  if (!isRecord(raw)) {
    return defaults;
  }
  const repo = parseRepo(raw['repo']);
  const limit = raw['limit'];
  const status = raw['status'];
  return {
    repo,
    branch: repo === null ? null : parseText(raw['branch']),
    limit: isRunLimit(limit) ? limit : defaults.limit,
    status: isRunStatusFilter(status) ? status : defaults.status,
    title: parseText(raw['title']),
  };
}

export function generatedTitle(
  config: Pick<ActionsRunsConfig, 'repo' | 'branch' | 'status'>,
): string {
  if (config.repo === null) {
    return 'Actions runs';
  }
  const branch = config.branch === null ? '' : ` @ ${config.branch}`;
  const failed = config.status === 'failure' ? ' (failed)' : '';
  return `Actions: ${repoFullName(config.repo)}${branch}${failed}`;
}

export function actionsRunsTitle(config: ActionsRunsConfig): string {
  return config.title ?? generatedTitle(config);
}

export function runsPageUrl(
  repo: RepoRef,
  branch: string | null,
  status: RunStatusFilter,
): string {
  const base = `${repoUrl(repo)}/actions`;
  const terms = [
    branch === null ? null : `branch:${branch}`,
    status === 'failure' ? 'is:failure' : null,
  ].filter((term) => term !== null);
  return terms.length === 0 ? base : `${base}?query=${encodeURIComponent(terms.join(' '))}`;
}
