import { isNonEmptyString, isOneOf, isRecord, isString } from '../../shared/guards.ts';
import { TOKEN_STATUSES, type TokenInfo, type TokenStatus } from '../../shared/tokens.ts';

export type OwnerSource = TokenInfo['ownerSource'];

export interface StoredToken {
  readonly id: string;
  readonly secret: string;
  readonly owner: string | null;
  readonly ownerSource: OwnerSource;
  readonly status: TokenStatus;
  readonly login: string | null;
  readonly expiresAt: string | null;
  readonly lastCheckedAt: string | null;
}

export interface StoredTokens {
  readonly version: 1;
  readonly entries: readonly StoredToken[];
}

export function serializeTokens(entries: readonly StoredToken[]): StoredTokens {
  return { version: 1, entries };
}

/**
 * Returns an empty list for anything that is not a token list. Broken entries and duplicates
 * are dropped so one bad entry does not cost the user the other tokens.
 */
export function parseStoredTokens(raw: unknown): StoredToken[] {
  if (!isRecord(raw) || raw['version'] !== 1 || !Array.isArray(raw['entries'])) {
    return [];
  }
  const ids = new Set<string>();
  const secrets = new Set<string>();
  const entries: StoredToken[] = [];
  for (const value of raw['entries']) {
    const entry = parseEntry(value);
    if (entry !== null && !ids.has(entry.id) && !secrets.has(entry.secret)) {
      ids.add(entry.id);
      secrets.add(entry.secret);
      entries.push(entry);
    }
  }
  return entries;
}

function parseEntry(value: unknown): StoredToken | null {
  if (!isRecord(value) || !isNonEmptyString(value['id']) || !isNonEmptyString(value['secret'])) {
    return null;
  }
  const owner = isNonEmptyString(value['owner']) ? value['owner'] : null;
  return {
    id: value['id'],
    secret: value['secret'],
    owner,
    ownerSource: owner === null ? null : value['ownerSource'] === 'manual' ? 'manual' : 'detected',
    status: isOneOf(TOKEN_STATUSES, value['status']) ? value['status'] : 'unchecked',
    login: isNonEmptyString(value['login']) ? value['login'] : null,
    expiresAt: parseTimestamp(value['expiresAt']),
    lastCheckedAt: parseTimestamp(value['lastCheckedAt']),
  };
}

function parseTimestamp(value: unknown): string | null {
  return isString(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function isPast(timestamp: string | null, now: Date): boolean {
  return timestamp !== null && Date.parse(timestamp) <= now.getTime();
}

/** A token stays `valid` in storage until it is checked again, even after its expiration. */
export function effectiveStatus(entry: StoredToken, now: Date): TokenStatus {
  return entry.status === 'valid' && isPast(entry.expiresAt, now) ? 'expired' : entry.status;
}

export function toTokenInfo(entry: StoredToken, now: Date): TokenInfo {
  return {
    id: entry.id,
    owner: entry.owner,
    ownerSource: entry.ownerSource,
    status: effectiveStatus(entry, now),
    login: entry.login,
    expiresAt: entry.expiresAt,
    lastCheckedAt: entry.lastCheckedAt,
    hint: entry.secret.slice(-4),
  };
}
