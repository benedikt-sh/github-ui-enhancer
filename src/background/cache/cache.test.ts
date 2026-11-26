import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAreaStore, type KeyValueStore } from '../../shared/storage.ts';
import { createFakeStorageArea } from '../../../test/fakes/storage.ts';
import { createCache, type CacheEntry, type GetOptions, type LoadResult } from './cache.ts';

const START = Date.parse('2026-01-01T00:00:00.000Z');
const MINUTE = 60_000;
const ENTRY_KEY = 'ghx:cache:entry:k';
const INDEX_KEY = 'ghx:cache:index';

const isNumber = (value: unknown): value is number => typeof value === 'number';
const isString = (value: unknown): value is string => typeof value === 'string';

/** The fakes only use promises, so one macrotask lets all background work finish. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Step = LoadResult<number> | Error | Promise<LoadResult<number>>;

function createLoader(...steps: Step[]) {
  const calls: Array<CacheEntry<number> | undefined> = [];
  const load = async (previous: CacheEntry<number> | undefined): Promise<LoadResult<number>> => {
    calls.push(previous);
    const step = steps.shift();
    if (step === undefined) {
      throw new Error('unexpected load');
    }
    if (step instanceof Error) {
      throw step;
    }
    return step;
  };
  return { calls, load };
}

const loaded = (value: number, meta?: Record<string, string>): LoadResult<number> =>
  meta === undefined ? { status: 'loaded', value } : { status: 'loaded', value, meta };

interface InstrumentedStore extends KeyValueStore {
  readonly reads: string[];
  failSetsFor(keys: string[]): void;
}

function instrument(inner: KeyValueStore): InstrumentedStore {
  const reads: string[] = [];
  let failing: string[] = [];
  return {
    reads,
    failSetsFor(keys) {
      failing = keys;
    },
    get(key) {
      reads.push(key);
      return inner.get(key);
    },
    async set(key, value) {
      if (failing.includes(key)) {
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      await inner.set(key, value);
    },
    remove: (key) => inner.remove(key),
  };
}

function setup(initial: Record<string, unknown> = {}) {
  const area = createFakeStorageArea(initial);
  const store = instrument(createAreaStore(area));
  const clock = { time: START };
  const storageErrors: Array<{ error: unknown; key: string }> = [];
  const cache = createCache({
    store,
    now: () => clock.time,
    onStorageError: (error, key) => storageErrors.push({ error, key }),
  });
  return { area, store, clock, cache, storageErrors };
}

function options(
  load: GetOptions<number>['load'],
  extra: Partial<GetOptions<number>> = {},
): GetOptions<number> {
  return { ttl: MINUTE, load, validate: isNumber, ...extra };
}

const iso = (time: number): string => new Date(time).toISOString();

function persistedRecord(value: unknown, fetchedAt: number, meta: Record<string, string> = {}) {
  return { version: 1, value, fetchedAt, meta };
}

describe('createCache get', () => {
  it('loads a missing key, persists it and lists it in the index', async () => {
    const { area, cache } = setup();
    const loader = createLoader(loaded(1, { etag: 'a' }));

    const result = await cache.get('k', options(loader.load));
    await settle();

    assert.deepEqual(result, { value: 1, fetchedAt: iso(START), stale: false });
    assert.deepEqual(loader.calls, [undefined]);
    assert.deepEqual(area.snapshot(), {
      [INDEX_KEY]: ['k'],
      [ENTRY_KEY]: persistedRecord(1, START, { etag: 'a' }),
    });
  });

  it('serves a fresh entry without loading and expires it after the ttl', async () => {
    const { cache, clock } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    clock.time = START + MINUTE - 1;
    const fresh = await cache.get('k', options(loader.load));
    clock.time = START + MINUTE;
    const reloaded = await cache.get('k', options(loader.load));

    assert.deepEqual(fresh, { value: 1, fetchedAt: iso(START), stale: false });
    assert.deepEqual(reloaded, { value: 2, fetchedAt: iso(START + MINUTE), stale: false });
    assert.equal(loader.calls.length, 2);
  });

  it('does not write the index again for a key it already lists', async () => {
    const { area, cache, clock } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    clock.time += MINUTE;
    await cache.get('k', options(loader.load));
    await settle();

    assert.deepEqual(area.snapshot()[INDEX_KEY], ['k']);
    assert.deepEqual(area.snapshot()[ENTRY_KEY], persistedRecord(2, START + MINUTE));
  });

  it('treats an entry from the future as expired', async () => {
    const { cache, clock } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    clock.time = START - 1;
    const result = await cache.get('k', options(loader.load));

    assert.equal(result.value, 2);
  });

  it('restores persisted entries after a restart and keeps them in memory', async () => {
    const { store, cache } = setup({ [ENTRY_KEY]: persistedRecord(7, START - 1000) });
    const loader = createLoader();

    const first = await cache.get('k', options(loader.load));
    const second = await cache.get('k', options(loader.load));

    assert.deepEqual(first, { value: 7, fetchedAt: iso(START - 1000), stale: false });
    assert.deepEqual(second, first);
    assert.deepEqual(store.reads, ['cache:entry:k']);
    assert.equal(loader.calls.length, 0);
  });

  it('treats persisted values failing validation or the format check as missing', async () => {
    const { cache } = setup({
      [ENTRY_KEY]: persistedRecord('old shape', START),
      'ghx:cache:entry:legacy': { value: 1, savedAt: START },
    });
    const loader = createLoader(loaded(1), loaded(2));

    assert.equal((await cache.get('k', options(loader.load))).value, 1);
    assert.equal((await cache.get('legacy', options(loader.load))).value, 2);
    assert.deepEqual(loader.calls, [undefined, undefined]);
  });

  it('passes the expired entry to load for conditional requests', async () => {
    const { cache, clock } = setup({
      [ENTRY_KEY]: persistedRecord(7, START - 2 * MINUTE, { etag: 'a' }),
    });
    const loader = createLoader(loaded(8));

    await cache.get('k', options(loader.load));

    assert.deepEqual(loader.calls, [
      { value: 7, fetchedAt: clock.time - 2 * MINUTE, meta: { etag: 'a' } },
    ]);
  });

  it('keeps value and metadata on "not modified" and resets the age', async () => {
    const { area, cache, clock } = setup({
      [ENTRY_KEY]: persistedRecord(7, START - 2 * MINUTE, { etag: 'a' }),
    });
    const loader = createLoader({ status: 'not-modified' });

    const result = await cache.get('k', options(loader.load));
    await settle();

    assert.deepEqual(result, { value: 7, fetchedAt: iso(clock.time), stale: false });
    assert.deepEqual(area.snapshot()[ENTRY_KEY], persistedRecord(7, START, { etag: 'a' }));
  });

  it('replaces metadata when "not modified" brings new metadata', async () => {
    const { area, cache } = setup({
      [ENTRY_KEY]: persistedRecord(7, START - 2 * MINUTE, { etag: 'a' }),
    });
    const loader = createLoader({ status: 'not-modified', meta: { etag: 'b' } });

    await cache.get('k', options(loader.load));
    await settle();

    assert.deepEqual(area.snapshot()[ENTRY_KEY], persistedRecord(7, START, { etag: 'b' }));
  });

  it('rejects "not modified" when nothing is cached', async () => {
    const { cache } = setup();
    const loader = createLoader({ status: 'not-modified' });

    await assert.rejects(cache.get('k', options(loader.load)), /nothing was cached/);
  });

  it('rejects with the load error when nothing is cached', async () => {
    const { area, cache } = setup();
    const failure = new Error('offline');

    await assert.rejects(cache.get('k', options(createLoader(failure).load)), failure);
    await settle();
    assert.deepEqual(area.snapshot(), {});
  });

  it('treats a synchronously throwing load like a failed one', async () => {
    const { cache } = setup();
    const load = (): Promise<LoadResult<number>> => {
      throw new Error('sync failure');
    };

    await assert.rejects(cache.get('k', options(load)), /sync failure/);
  });

  it('serves the expired value as stale with the error when the refresh fails', async () => {
    const { cache, clock } = setup();
    const failure = new Error('offline');
    const loader = createLoader(loaded(1), failure, loaded(2));

    await cache.get('k', options(loader.load));
    clock.time += MINUTE;
    const failed = await cache.get('k', options(loader.load));
    const retried = await cache.get('k', options(loader.load));

    assert.deepEqual(failed, { value: 1, fetchedAt: iso(START), stale: true, error: failure });
    assert.deepEqual(retried, { value: 2, fetchedAt: iso(START + MINUTE), stale: false });
  });

  it('always loads with forceRefresh and keeps the old value if that fails', async () => {
    const { cache } = setup();
    const failure = new Error('rate limited');
    const loader = createLoader(loaded(1), loaded(2), failure);
    const force = options(loader.load, { forceRefresh: true });

    await cache.get('k', options(loader.load));
    const forced = await cache.get('k', force);
    const failed = await cache.get('k', force);

    assert.equal(forced.value, 2);
    assert.deepEqual(failed, { value: 2, fetchedAt: iso(START), stale: true, error: failure });
    assert.equal(loader.calls.length, 3);
  });

  it('ignores staleWhileRevalidate for fresh entries and with forceRefresh', async () => {
    const { cache } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    const fresh = await cache.get('k', options(loader.load, { staleWhileRevalidate: true }));
    const forced = await cache.get(
      'k',
      options(loader.load, { staleWhileRevalidate: true, forceRefresh: true }),
    );

    assert.equal(fresh.value, 1);
    assert.deepEqual(forced, { value: 2, fetchedAt: iso(START), stale: false });
  });

  it('awaits the load for a missing key even with staleWhileRevalidate', async () => {
    const { cache } = setup();
    const loader = createLoader(loaded(1));

    const result = await cache.get('k', options(loader.load, { staleWhileRevalidate: true }));

    assert.deepEqual(result, { value: 1, fetchedAt: iso(START), stale: false });
  });
});

describe('createCache stale-while-revalidate', () => {
  it('serves the expired value at once and refreshes in the background', async () => {
    const { cache, clock } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(loaded(1), gate.promise);
    const swr = options(loader.load, { staleWhileRevalidate: true });

    await cache.get('k', swr);
    clock.time += MINUTE;
    const stale = await cache.get('k', swr);
    assert.deepEqual(stale, { value: 1, fetchedAt: iso(START), stale: true });
    assert.equal(loader.calls.length, 2);

    gate.resolve(loaded(2));
    await settle();
    const refreshed = await cache.get('k', swr);
    assert.deepEqual(refreshed, { value: 2, fetchedAt: iso(START + MINUTE), stale: false });
  });

  it('drops background failures and retries on the next call', async () => {
    const { cache, clock } = setup();
    const loader = createLoader(loaded(1), new Error('offline'), loaded(2));
    const swr = options(loader.load, { staleWhileRevalidate: true });

    await cache.get('k', swr);
    clock.time += MINUTE;
    const first = await cache.get('k', swr);
    await settle();
    const second = await cache.get('k', swr);
    await settle();
    const third = await cache.get('k', swr);

    assert.deepEqual(first, { value: 1, fetchedAt: iso(START), stale: true });
    assert.deepEqual(second, first);
    assert.deepEqual(third, { value: 2, fetchedAt: iso(START + MINUTE), stale: false });
  });

  it('lets waiting callers join a background refresh', async () => {
    const { cache, clock } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(loaded(1), gate.promise);

    await cache.get('k', options(loader.load));
    clock.time += MINUTE;
    await cache.get('k', options(loader.load, { staleWhileRevalidate: true }));
    const waiting = cache.get('k', options(loader.load));
    gate.resolve(loaded(2));

    assert.equal((await waiting).value, 2);
    assert.equal(loader.calls.length, 2);
  });
});

describe('createCache in-flight deduplication', () => {
  it('shares one load between concurrent calls, including forceRefresh', async () => {
    const { cache } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(gate.promise);

    const first = cache.get('k', options(loader.load));
    const second = cache.get('k', options(loader.load));
    await settle();
    const forced = cache.get('k', options(loader.load, { forceRefresh: true }));
    gate.resolve(loaded(1));

    const results = await Promise.all([first, second, forced]);
    assert.deepEqual(results.map((result) => result.value), [1, 1, 1]);
    assert.equal(loader.calls.length, 1);
  });

  it('shares a failure between concurrent calls', async () => {
    const { cache } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(gate.promise);

    const first = cache.get('k', options(loader.load));
    const second = cache.get('k', options(loader.load));
    await settle();
    gate.reject(new Error('offline'));

    await assert.rejects(first, /offline/);
    await assert.rejects(second, /offline/);
    assert.equal(loader.calls.length, 1);
  });

  it('keeps loads of different keys apart', async () => {
    const { cache } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    const [a, b] = await Promise.all([
      cache.get('a', options(loader.load)),
      cache.get('b', options(loader.load)),
    ]);

    assert.deepEqual([a.value, b.value], [1, 2]);
  });

  it('starts a new load once the shared one settled', async () => {
    const { cache } = setup();
    const loader = createLoader(loaded(1), loaded(2));
    const force = options(loader.load, { forceRefresh: true });

    await cache.get('k', force);
    const second = await cache.get('k', force);

    assert.equal(second.value, 2);
  });

  it('reads storage once for concurrent calls on a cold key', async () => {
    const { store, cache } = setup({ [ENTRY_KEY]: persistedRecord(7, START) });
    const loader = createLoader();

    const results = await Promise.all([
      cache.get('k', options(loader.load)),
      cache.get('k', options(loader.load)),
    ]);

    assert.deepEqual(results.map((result) => result.value), [7, 7]);
    assert.deepEqual(store.reads, ['cache:entry:k']);
  });

  it('rejects a joining caller whose validator does not accept the shared value', async () => {
    const { cache } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(gate.promise);

    const first = cache.get('k', options(loader.load));
    await settle();
    const mismatched = cache.get('k', {
      ttl: MINUTE,
      validate: isString,
      load: () => Promise.reject(new Error('not called')),
    });
    gate.resolve(loaded(1));

    assert.equal((await first).value, 1);
    await assert.rejects(mismatched, /does not match the expected type/);
  });

  it('does not serve a memory value of another type', async () => {
    const { cache } = setup({ [ENTRY_KEY]: persistedRecord(7, START) });

    await cache.get('k', options(createLoader().load));
    const text = await cache.get('k', {
      ttl: MINUTE,
      validate: isString,
      load: async () => ({ status: 'loaded', value: 'seven' }),
    });

    assert.equal(text.value, 'seven');
  });
});

describe('createCache storage failures', () => {
  it('treats unreadable entries as missing and reports the error', async () => {
    const { area, cache, storageErrors } = setup({ [ENTRY_KEY]: persistedRecord(7, START) });
    const failure = new Error('storage unavailable');
    area.failWith(failure);

    const result = await cache.get('k', options(createLoader(loaded(1)).load));
    await settle();

    assert.equal(result.value, 1);
    assert.deepEqual(storageErrors, [
      { error: failure, key: 'k' },
      { error: failure, key: 'k' },
    ]);
  });

  it('keeps values in memory when the entry write fails', async () => {
    const { area, store, cache, storageErrors } = setup();
    store.failSetsFor(['cache:entry:k']);
    const loader = createLoader(loaded(1));

    await cache.get('k', options(loader.load));
    await settle();
    const again = await cache.get('k', options(loader.load));

    assert.equal(again.value, 1);
    assert.equal(loader.calls.length, 1);
    assert.equal(storageErrors.length, 1);
    assert.match(String(storageErrors[0]?.error), /quota exceeded/);
    assert.deepEqual(area.snapshot(), { [INDEX_KEY]: ['k'] });
  });

  it('skips the entry write when the index write fails and retries the index later', async () => {
    const { area, store, cache, clock, storageErrors } = setup();
    store.failSetsFor(['cache:index']);
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    await settle();
    assert.deepEqual(area.snapshot(), {});
    assert.equal(storageErrors.length, 1);

    store.failSetsFor([]);
    clock.time += MINUTE;
    await cache.get('k', options(loader.load));
    await settle();
    assert.deepEqual(area.snapshot(), {
      [INDEX_KEY]: ['k'],
      [ENTRY_KEY]: persistedRecord(2, START + MINUTE),
    });
  });

  it('ignores storage errors without a reporter', async () => {
    const area = createFakeStorageArea();
    area.failWith(new Error('storage unavailable'));
    const cache = createCache({ store: createAreaStore(area), now: () => START });

    const result = await cache.get('k', options(createLoader(loaded(1)).load));
    await settle();

    assert.equal(result.value, 1);
  });
});

describe('createCache invalidate', () => {
  it('removes the entry from memory, storage and index', async () => {
    const { area, cache } = setup({ 'ghx:layout': { version: 1 } });
    const loader = createLoader(loaded(1), loaded(2), loaded(3));

    await cache.get('k', options(loader.load));
    await cache.get('other', options(loader.load));
    await cache.invalidate('k');
    const reloaded = await cache.get('k', options(loader.load));

    assert.equal(reloaded.value, 3);
    await cache.invalidate('k');
    assert.deepEqual(area.snapshot(), {
      'ghx:layout': { version: 1 },
      [INDEX_KEY]: ['other'],
      'ghx:cache:entry:other': persistedRecord(2, START),
    });
  });

  it('leaves the index alone for keys it does not list', async () => {
    const { area, cache } = setup({ [INDEX_KEY]: ['a'] });

    await cache.invalidate('unknown');

    assert.deepEqual(area.snapshot(), { [INDEX_KEY]: ['a'] });
  });

  it('does not cache the result of a load that was running during invalidation', async () => {
    const { cache } = setup();
    const first = deferred<LoadResult<number>>();
    const second = deferred<LoadResult<number>>();
    const loader = createLoader(first.promise, second.promise, loaded(3));

    const before = cache.get('k', options(loader.load));
    await settle();
    await cache.invalidate('k');
    const after = cache.get('k', options(loader.load));
    await settle();
    first.resolve(loaded(1));
    assert.equal((await before).value, 1);
    second.resolve(loaded(2));

    assert.equal((await after).value, 2);
    assert.equal((await cache.get('k', options(loader.load))).value, 2);
    assert.equal(loader.calls.length, 2);
  });

  it('does not keep what a storage read returned after invalidation', async () => {
    const { cache } = setup({ [ENTRY_KEY]: persistedRecord(7, START) });
    const loader = createLoader(loaded(1));

    const reading = cache.get('k', options(loader.load));
    const invalidating = cache.invalidate('k');

    assert.equal((await reading).value, 1);
    await invalidating;
    assert.deepEqual(loader.calls, [undefined]);
  });

  it('rejects when storage fails but still forgets the value', async () => {
    const { area, cache } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    await settle();
    area.failWith(new Error('storage unavailable'));
    await assert.rejects(cache.invalidate('k'), /storage unavailable/);
    const result = await cache.get('k', options(loader.load));

    assert.equal(result.value, 2);
  });
});

describe('createCache clear', () => {
  it('removes all cache entries, also those of an earlier session', async () => {
    const { area, cache } = setup({
      'ghx:layout': { version: 1 },
      [INDEX_KEY]: ['old'],
      'ghx:cache:entry:old': persistedRecord(1, START),
    });
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    await cache.clear();
    const reloaded = await cache.get('k', options(loader.load));
    await cache.clear();

    assert.equal(reloaded.value, 2);
    assert.deepEqual(area.snapshot(), { 'ghx:layout': { version: 1 } });
  });

  it('runs after writes that were queued before it', async () => {
    const { area, cache } = setup();

    const loading = cache.get('k', options(createLoader(loaded(1)).load));
    await loading;
    await cache.clear();

    assert.deepEqual(area.snapshot(), {});
  });

  it('does not cache the result of a load that was running during clear', async () => {
    const { area, cache } = setup();
    const gate = deferred<LoadResult<number>>();
    const loader = createLoader(gate.promise, loaded(2));

    const before = cache.get('k', options(loader.load));
    await settle();
    await cache.clear();
    gate.resolve(loaded(1));
    assert.equal((await before).value, 1);
    await settle();

    assert.deepEqual(area.snapshot(), {});
    assert.equal((await cache.get('k', options(loader.load))).value, 2);
  });

  it('rejects when storage fails but still empties memory', async () => {
    const { area, cache } = setup();
    const loader = createLoader(loaded(1), loaded(2));

    await cache.get('k', options(loader.load));
    await settle();
    area.failWith(new Error('storage unavailable'));
    await assert.rejects(cache.clear(), /storage unavailable/);

    assert.equal((await cache.get('k', options(loader.load))).value, 2);
  });
});
