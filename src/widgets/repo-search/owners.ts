import type { RepoSummary } from '../../shared/types.ts';

/**
 * Distinct owners, compared case-insensitively like the search filter and sorted by name.
 * `selected` is kept even if no repo belongs to it, so a stored filter stays visible.
 */
export function collectOwners(
  repos: readonly RepoSummary[],
  selected: string | null = null,
): string[] {
  const owners = new Map<string, string>();
  for (const owner of [...(selected === null ? [] : [selected]), ...repos.map((r) => r.owner)]) {
    const key = owner.toLowerCase();
    if (!owners.has(key)) {
      owners.set(key, owner);
    }
  }
  return [...owners.values()].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
}
