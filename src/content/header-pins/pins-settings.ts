import { isRecord } from '../../shared/guards.ts';
import { parseRepoFullName, repoFullName } from '../../shared/repo.ts';
import type { RepoRef } from '../../shared/types.ts';

export const PINS_VERSION = 1;
/** More links do not fit next to GitHub's search on common screen widths. */
export const MAX_PINS = 8;

export interface PinsSettings {
  readonly repos: readonly RepoRef[];
  /** Adds an automatic pin for the repository with the latest own code activity. */
  readonly recent: boolean;
}

export interface StoredPins {
  readonly version: typeof PINS_VERSION;
  readonly repos: readonly RepoRef[];
  readonly recent: boolean;
}

export function defaultPins(): PinsSettings {
  return { repos: [], recent: true };
}

/** GitHub logins and repository names are case-insensitive. */
export function repoKey(repo: RepoRef): string {
  return repoFullName(repo).toLowerCase();
}

export function isPinned(settings: PinsSettings, repo: RepoRef): boolean {
  const key = repoKey(repo);
  return settings.repos.some((pinned) => repoKey(pinned) === key);
}

/**
 * Anything unknown, including other versions, yields the defaults. Invalid and duplicate repos
 * are dropped, the first spelling of a duplicate wins.
 */
export function parsePins(raw: unknown): PinsSettings {
  const defaults = defaultPins();
  if (!isRecord(raw) || raw['version'] !== PINS_VERSION) {
    return defaults;
  }
  const repos: RepoRef[] = [];
  const entries: unknown[] = Array.isArray(raw['repos']) ? raw['repos'] : [];
  for (const entry of entries) {
    const repo = parseRepo(entry);
    if (repo !== null && repos.length < MAX_PINS && !isPinned({ repos, recent: false }, repo)) {
      repos.push(repo);
    }
  }
  const recent = typeof raw['recent'] === 'boolean' ? raw['recent'] : defaults.recent;
  return { repos, recent };
}

export function parseRepo(value: unknown): RepoRef | null {
  if (!isRecord(value) || typeof value['owner'] !== 'string' || typeof value['name'] !== 'string') {
    return null;
  }
  return parseRepoFullName(`${value['owner']}/${value['name']}`);
}

export function serializePins(settings: PinsSettings): StoredPins {
  return {
    version: PINS_VERSION,
    repos: settings.repos.map(({ owner, name }) => ({ owner, name })),
    recent: settings.recent,
  };
}

export function samePins(a: PinsSettings, b: PinsSettings): boolean {
  return JSON.stringify(serializePins(a)) === JSON.stringify(serializePins(b));
}

/** No-op for duplicates and once {@link MAX_PINS} is reached. */
export function addPin(settings: PinsSettings, repo: RepoRef): PinsSettings {
  if (settings.repos.length >= MAX_PINS || isPinned(settings, repo)) {
    return settings;
  }
  return { ...settings, repos: [...settings.repos, { owner: repo.owner, name: repo.name }] };
}

export function removePin(settings: PinsSettings, repo: RepoRef): PinsSettings {
  const key = repoKey(repo);
  return { ...settings, repos: settings.repos.filter((pinned) => repoKey(pinned) !== key) };
}

export function setRecent(settings: PinsSettings, recent: boolean): PinsSettings {
  return { ...settings, recent };
}
