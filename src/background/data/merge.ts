import type { DataResult } from '../../shared/data.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** What one token contributed to a merged result. */
export interface Part<T> {
  readonly items: readonly T[];
  readonly errors: readonly ApiErrorInfo[];
  /** ISO 8601, null if the token delivered nothing. */
  readonly fetchedAt: string | null;
  readonly stale: boolean;
}

export interface MergeOptions<T> {
  readonly identify: (item: T) => string;
  readonly compare: (a: T, b: T) => number;
  readonly limit?: number;
  /** ISO 8601 used as `fetchedAt` when no part delivered anything. */
  readonly now: string;
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Newest first, entries without a timestamp last. */
export function byNewest<T>(timestamp: (item: T) => string | null): (a: T, b: T) => number {
  return (a, b) => {
    const left = timestamp(a);
    const right = timestamp(b);
    if (left === right) {
      return 0;
    }
    if (left === null || right === null) {
      return left === null ? 1 : -1;
    }
    return left < right ? 1 : -1;
  };
}

/**
 * Merges the parts of all tokens. The same item can reach several tokens (e.g. a pull request
 * in a public repository), so the first occurrence wins. The result is as old as its oldest
 * part and stale if any part is.
 */
export function mergeParts<T>(parts: readonly Part<T>[], options: MergeOptions<T>): DataResult<T[]> {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const part of parts) {
    for (const item of part.items) {
      const id = options.identify(item);
      if (!seen.has(id)) {
        seen.add(id);
        items.push(item);
      }
    }
  }
  items.sort(options.compare);
  const times = parts.map((part) => part.fetchedAt).filter((time) => time !== null);
  return {
    data: options.limit === undefined ? items : items.slice(0, options.limit),
    errors: parts.flatMap((part) => part.errors),
    fetchedAt: times.length === 0 ? options.now : times.reduce((a, b) => (b < a ? b : a)),
    stale: parts.some((part) => part.stale),
  };
}

/**
 * Keeps the first error of each kind and owner, e.g. one network error instead of one per
 * repository of the same owner.
 */
export function uniqueErrors(errors: readonly ApiErrorInfo[]): ApiErrorInfo[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = JSON.stringify([error.kind, error.owner ?? null]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
