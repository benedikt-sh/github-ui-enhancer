import type { KeyValueStore } from '../../shared/storage.ts';
import {
  INDEX_STORAGE_KEY,
  entryStorageKey,
  parseIndex,
  parseStoredRecord,
  toStoredRecord,
  type CacheMeta,
} from './persisted-entry.ts';

export type { CacheMeta } from './persisted-entry.ts';

export interface CacheEntry<T> {
  readonly value: T;
  /** Epoch milliseconds of the last successful load or "not modified" answer. */
  readonly fetchedAt: number;
  readonly meta: CacheMeta;
}

export type LoadResult<T> =
  | { readonly status: 'loaded'; readonly value: T; readonly meta?: CacheMeta }
  /** Keeps the previous value and resets its age. `meta` replaces the previous one if given. */
  | { readonly status: 'not-modified'; readonly meta?: CacheMeta };

export interface GetOptions<T> {
  /** Milliseconds after `fetchedAt` during which the entry is served without calling `load`. */
  readonly ttl: number;
  /** Receives the cached entry, even an expired one, to allow conditional requests. */
  readonly load: (previous: CacheEntry<T> | undefined) => Promise<LoadResult<T>>;
  /** Cached values may stem from older extension versions; failing ones count as missing. */
  readonly validate: (value: unknown) => value is T;
  readonly forceRefresh?: boolean;
  /** Serves an expired entry at once and refreshes it in the background. */
  readonly staleWhileRevalidate?: boolean;
}

export interface CacheResult<T> {
  /** Shared with other callers, so it must not be mutated. */
  readonly value: T;
  /** ISO 8601, matching `DataResult.fetchedAt`. */
  readonly fetchedAt: string;
  readonly stale: boolean;
  /** What `load` threw when the previous value is served instead of a fresh one. */
  readonly error?: unknown;
}

export interface Cache {
  /** Rejects only when `load` fails and nothing usable is cached. */
  get<T>(key: string, options: GetOptions<T>): Promise<CacheResult<T>>;
  /** Rejects when the persisted entry could not be removed; memory is cleared regardless. */
  invalidate(key: string): Promise<void>;
  /** Rejects when the persisted entries could not be removed; memory is cleared regardless. */
  clear(): Promise<void>;
}

export interface CacheOptions {
  readonly store: KeyValueStore;
  readonly now: () => number;
  /**
   * Failed storage reads and writes during `get` are reported here and otherwise ignored:
   * values stay in memory, so e.g. an exceeded quota only costs persistence across restarts.
   */
  readonly onStorageError?: (error: unknown, key: string) => void;
}

type AnyEntry = CacheEntry<unknown>;

export function createCache(options: CacheOptions): Cache {
  const { store, now } = options;
  const reportStorageError = options.onStorageError ?? (() => {});

  const memory = new Map<string, AnyEntry>();
  const inflightLoads = new Map<string, Promise<AnyEntry>>();
  const pendingReads = new Map<string, Promise<AnyEntry | undefined>>();
  // A load or storage read may only fill memory if the key was not invalidated since it
  // started. `invalidate` and `clear` drop the token, which makes older work recognizable.
  const tokens = new Map<string, object>();

  // All storage writes run one after another, so the index never races with itself and a
  // removal always lands after writes that were queued before it.
  let writeQueue: Promise<void> = Promise.resolve();
  let index: Set<string> | undefined;

  function tokenFor(key: string): object {
    let token = tokens.get(key);
    if (token === undefined) {
      token = {};
      tokens.set(key, token);
    }
    return token;
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = writeQueue.then(task);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function loadIndex(): Promise<Set<string>> {
    index ??= new Set(parseIndex(await store.get(INDEX_STORAGE_KEY)));
    return index;
  }

  function persist(key: string, entry: AnyEntry): void {
    enqueue(async () => {
      const keys = await loadIndex();
      if (!keys.has(key)) {
        // Index first: a listed key without entry is harmless, an unlisted entry is never cleared.
        await store.set(INDEX_STORAGE_KEY, [...keys, key]);
        keys.add(key);
      }
      await store.set(entryStorageKey(key), toStoredRecord(entry));
    }).catch((error: unknown) => reportStorageError(error, key));
  }

  async function readStored(key: string): Promise<AnyEntry | undefined> {
    try {
      return parseStoredRecord(await store.get(entryStorageKey(key)));
    } catch (error) {
      reportStorageError(error, key);
      return undefined;
    }
  }

  async function readPersisted<T>(
    key: string,
    validate: (value: unknown) => value is T,
  ): Promise<CacheEntry<T> | undefined> {
    const token = tokenFor(key);
    let pending = pendingReads.get(key);
    if (pending === undefined) {
      const read = readStored(key);
      pendingReads.set(key, read);
      void read.then(() => {
        if (pendingReads.get(key) === read) {
          pendingReads.delete(key);
        }
      });
      pending = read;
    }
    const stored = await pending;
    const current = memory.get(key);
    if (current !== undefined) {
      return narrow(current, validate);
    }
    if (stored === undefined || tokens.get(key) !== token) {
      return undefined;
    }
    const entry = narrow(stored, validate);
    if (entry !== undefined) {
      memory.set(key, entry);
    }
    return entry;
  }

  function startLoad<T>(
    key: string,
    previous: CacheEntry<T> | undefined,
    load: GetOptions<T>['load'],
  ): Promise<CacheEntry<T>> {
    const token = tokenFor(key);
    const loading = (async () => {
      const entry = toEntry(await load(previous), previous, now());
      if (tokens.get(key) === token) {
        memory.set(key, entry);
        persist(key, entry);
      }
      return entry;
    })();
    inflightLoads.set(key, loading);
    const cleanup = (): void => {
      if (inflightLoads.get(key) === loading) {
        inflightLoads.delete(key);
      }
    };
    loading.then(cleanup, cleanup);
    return loading;
  }

  function refresh<T>(
    key: string,
    previous: CacheEntry<T> | undefined,
    options: GetOptions<T>,
  ): Promise<CacheEntry<T>> {
    const running = inflightLoads.get(key);
    if (running === undefined) {
      return startLoad(key, previous, options.load);
    }
    return running.then((entry) => {
      const narrowed = narrow(entry, options.validate);
      if (narrowed === undefined) {
        throw new TypeError(`Cached value for "${key}" does not match the expected type`);
      }
      return narrowed;
    });
  }

  function isFresh(entry: AnyEntry, ttl: number): boolean {
    // A timestamp in the future means the clock went back; trusting it could pin the entry.
    const age = now() - entry.fetchedAt;
    return age >= 0 && age < ttl;
  }

  return {
    async get<T>(key: string, getOptions: GetOptions<T>): Promise<CacheResult<T>> {
      const memoryEntry = memory.get(key);
      let cached: CacheEntry<T> | undefined;
      if (memoryEntry !== undefined) {
        cached = narrow(memoryEntry, getOptions.validate);
      } else if (!inflightLoads.has(key)) {
        // With a load running and memory empty, storage held nothing usable when it started.
        // Reading it again could let the load finish meanwhile and start a second one.
        cached = await readPersisted(key, getOptions.validate);
      }

      if (cached !== undefined && getOptions.forceRefresh !== true) {
        if (isFresh(cached, getOptions.ttl)) {
          return toResult(cached, false);
        }
        if (getOptions.staleWhileRevalidate === true) {
          // Failures are dropped: the entry stays expired, so the next `get` tries again.
          refresh(key, cached, getOptions).catch(() => {});
          return toResult(cached, true);
        }
      }

      try {
        return toResult(await refresh(key, cached, getOptions), false);
      } catch (error) {
        if (cached === undefined) {
          throw error;
        }
        return { ...toResult(cached, true), error };
      }
    },

    invalidate(key) {
      memory.delete(key);
      inflightLoads.delete(key);
      pendingReads.delete(key);
      tokens.delete(key);
      return enqueue(async () => {
        await store.remove(entryStorageKey(key));
        const keys = await loadIndex();
        if (keys.has(key)) {
          await store.set(
            INDEX_STORAGE_KEY,
            [...keys].filter((listed) => listed !== key),
          );
          keys.delete(key);
        }
      });
    },

    clear() {
      memory.clear();
      inflightLoads.clear();
      pendingReads.clear();
      tokens.clear();
      return enqueue(async () => {
        const keys = await loadIndex();
        for (const key of keys) {
          await store.remove(entryStorageKey(key));
        }
        await store.remove(INDEX_STORAGE_KEY);
        keys.clear();
      });
    },
  };
}

function narrow<T>(
  entry: AnyEntry,
  validate: (value: unknown) => value is T,
): CacheEntry<T> | undefined {
  const { value } = entry;
  return validate(value) ? { value, fetchedAt: entry.fetchedAt, meta: entry.meta } : undefined;
}

function toEntry<T>(
  result: LoadResult<T>,
  previous: CacheEntry<T> | undefined,
  fetchedAt: number,
): CacheEntry<T> {
  if (result.status === 'loaded') {
    return { value: result.value, fetchedAt, meta: result.meta ?? {} };
  }
  if (previous === undefined) {
    throw new Error('Load answered "not modified" although nothing was cached');
  }
  return { value: previous.value, fetchedAt, meta: result.meta ?? previous.meta };
}

function toResult<T>(entry: CacheEntry<T>, stale: boolean): CacheResult<T> {
  return { value: entry.value, fetchedAt: new Date(entry.fetchedAt).toISOString(), stale };
}
