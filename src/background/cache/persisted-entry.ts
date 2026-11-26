import { isRecord, isString } from '../../shared/guards.ts';
import { STORAGE_KEYS } from '../../shared/storage.ts';

/** Small string metadata kept next to a value, e.g. an ETag for conditional requests. */
export type CacheMeta = Readonly<Record<string, string>>;

export interface StoredEntry {
  readonly value: unknown;
  /** Epoch milliseconds. */
  readonly fetchedAt: number;
  readonly meta: CacheMeta;
}

const FORMAT_VERSION = 1;

/** Lists every key the cache wrote, so `clear()` can find them without listing the storage. */
export const INDEX_STORAGE_KEY = `${STORAGE_KEYS.cachePrefix}index`;

export function entryStorageKey(key: string): string {
  return `${STORAGE_KEYS.cachePrefix}entry:${key}`;
}

export function toStoredRecord(entry: StoredEntry): Record<string, unknown> {
  return {
    version: FORMAT_VERSION,
    value: entry.value,
    fetchedAt: entry.fetchedAt,
    meta: entry.meta,
  };
}

/** Returns `undefined` for anything not written by the current format. */
export function parseStoredRecord(raw: unknown): StoredEntry | undefined {
  if (!isRecord(raw) || raw['version'] !== FORMAT_VERSION) {
    return undefined;
  }
  const fetchedAt = raw['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    return undefined;
  }
  return { value: raw['value'], fetchedAt, meta: parseMeta(raw['meta']) };
}

/** Broken metadata only costs a conditional request, so it is dropped instead of the entry. */
function parseMeta(raw: unknown): CacheMeta {
  const meta: Record<string, string> = {};
  if (isRecord(raw)) {
    for (const [name, value] of Object.entries(raw)) {
      if (isString(value)) {
        meta[name] = value;
      }
    }
  }
  return meta;
}

export function parseIndex(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter(isString) : [];
}
