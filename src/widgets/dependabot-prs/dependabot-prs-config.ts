import { isRecord, isString } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import type { RepoRef } from '../../shared/types.ts';

export const DEPENDABOT_LIMITS = [5, 10, 20, 50] as const;

export type DependabotLimit = (typeof DEPENDABOT_LIMITS)[number];

export const DEFAULT_DEPENDABOT_LIMIT: DependabotLimit = 10;

export const MAX_REPOS = 30;

export const DEFAULT_TITLE = 'Dependabot pull requests';

export interface DependabotPrsConfig {
  readonly repos: readonly RepoRef[];
  /** Custom widget title, null derives it from the repositories. */
  readonly title: string | null;
  readonly limit: DependabotLimit;
  readonly groupByRepo: boolean;
}

export function defaultDependabotPrsConfig(): DependabotPrsConfig {
  return { repos: [], title: null, limit: DEFAULT_DEPENDABOT_LIMIT, groupByRepo: false };
}

export function isDependabotLimit(value: unknown): value is DependabotLimit {
  return DEPENDABOT_LIMITS.some((limit) => limit === value);
}

/** Case-insensitive, as GitHub owner and repository names are. */
export function repoKey(repo: RepoRef): string {
  return repoFullName(repo).toLowerCase();
}

export function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return repoKey(a) === repoKey(b);
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

/** Keeps the first spelling of each repository and at most {@link MAX_REPOS} of them. */
export function parseRepos(value: unknown): RepoRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const repos: RepoRef[] = [];
  for (const entry of value as readonly unknown[]) {
    const repo = parseRepo(entry);
    if (repo === null || seen.has(repoKey(repo))) {
      continue;
    }
    seen.add(repoKey(repo));
    repos.push(repo);
    if (repos.length === MAX_REPOS) {
      break;
    }
  }
  return repos;
}

export function normalizeTitle(value: unknown): string | null {
  if (!isString(value)) {
    return null;
  }
  const title = value.trim();
  return title === '' ? null : title;
}

export function parseDependabotPrsConfig(raw: unknown): DependabotPrsConfig {
  const defaults = defaultDependabotPrsConfig();
  if (!isRecord(raw)) {
    return defaults;
  }
  const { limit, groupByRepo } = raw;
  return {
    repos: parseRepos(raw['repos']),
    title: normalizeTitle(raw['title']),
    limit: isDependabotLimit(limit) ? limit : defaults.limit,
    groupByRepo: typeof groupByRepo === 'boolean' ? groupByRepo : defaults.groupByRepo,
  };
}

export function generatedTitle(repos: readonly RepoRef[]): string {
  const [first] = repos;
  if (first === undefined) {
    return DEFAULT_TITLE;
  }
  return repos.length === 1
    ? `Dependabot: ${repoFullName(first)}`
    : `Dependabot: ${repos.length} repositories`;
}

export function dependabotPrsTitle(config: DependabotPrsConfig): string {
  return config.title ?? generatedTitle(config.repos);
}
