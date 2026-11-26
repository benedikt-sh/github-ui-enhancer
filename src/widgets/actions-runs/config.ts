import { isRecord, isString } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import type { RepoRef } from '../../shared/types.ts';
import { repoUrl } from '../../ui/row.ts';

export const RUN_LIMITS = [5, 10, 20] as const;

export type RunLimit = (typeof RUN_LIMITS)[number];

export const DEFAULT_RUN_LIMIT: RunLimit = 10;

export interface ActionsRunsConfig {
  readonly repo: RepoRef | null;
  /** Null shows runs of all branches. */
  readonly branch: string | null;
  readonly limit: RunLimit;
  /** Null uses the generated title. */
  readonly title: string | null;
}

export function defaultActionsRunsConfig(): ActionsRunsConfig {
  return { repo: null, branch: null, limit: DEFAULT_RUN_LIMIT, title: null };
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

export function parseActionsRunsConfig(raw: unknown): ActionsRunsConfig {
  const defaults = defaultActionsRunsConfig();
  if (!isRecord(raw)) {
    return defaults;
  }
  const repo = parseRepo(raw['repo']);
  const limit = raw['limit'];
  return {
    repo,
    branch: repo === null ? null : parseText(raw['branch']),
    limit: isRunLimit(limit) ? limit : defaults.limit,
    title: parseText(raw['title']),
  };
}

export function generatedTitle(config: Pick<ActionsRunsConfig, 'repo' | 'branch'>): string {
  if (config.repo === null) {
    return 'Actions runs';
  }
  const branch = config.branch === null ? '' : ` @ ${config.branch}`;
  return `Actions: ${repoFullName(config.repo)}${branch}`;
}

export function actionsRunsTitle(config: ActionsRunsConfig): string {
  return config.title ?? generatedTitle(config);
}

export function runsPageUrl(repo: RepoRef, branch: string | null): string {
  const base = `${repoUrl(repo)}/actions`;
  return branch === null ? base : `${base}?query=${encodeURIComponent(`branch:${branch}`)}`;
}
