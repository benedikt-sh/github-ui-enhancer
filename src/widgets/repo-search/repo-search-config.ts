import { isRecord } from '../../shared/guards.ts';

export interface RepoSearchConfig {
  /** Only repos of this owner, null for all owners. */
  readonly owner: string | null;
  readonly includeArchived: boolean;
}

export function defaultRepoSearchConfig(): RepoSearchConfig {
  return { owner: null, includeArchived: false };
}

function parseOwner(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const owner = value.trim();
  return owner === '' ? null : owner;
}

export function parseRepoSearchConfig(raw: unknown): RepoSearchConfig {
  if (!isRecord(raw)) {
    return defaultRepoSearchConfig();
  }
  const includeArchived = raw['includeArchived'];
  return {
    owner: parseOwner(raw['owner']),
    includeArchived: typeof includeArchived === 'boolean' ? includeArchived : false,
  };
}
