import { sameOwner } from '../../shared/repo.ts';
import type { ActiveToken } from '../tokens/token-registry.ts';

function isPersonal(token: ActiveToken): boolean {
  return token.owner !== null && token.login !== null && sameOwner(token.owner, token.login);
}

/**
 * GitHub search returns matches from everything the user can see, but a fine-grained token
 * only reads resources of its owner. Foreign matches come back as FORBIDDEN null nodes and
 * use up result slots. Org tokens are therefore limited to their org, and the personal token
 * skips the orgs that have a token of their own.
 */
export function scopeSearchQuery(
  query: string,
  token: ActiveToken,
  tokens: readonly ActiveToken[],
): string {
  if (token.owner === null || token.login === null) {
    return query;
  }
  if (!isPersonal(token)) {
    return `${query} org:${token.owner}`;
  }
  const excluded: string[] = [];
  for (const other of tokens) {
    const owner = other.owner;
    if (
      other.id !== token.id &&
      owner !== null &&
      !isPersonal(other) &&
      !excluded.some((known) => sameOwner(known, owner))
    ) {
      excluded.push(owner);
    }
  }
  return [query, ...excluded.map((owner) => `-org:${owner}`)].join(' ');
}
