import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RecentRepoItem, RepoSummary } from '../../shared/types.ts';
import { deferred, flush, NOW, recentItem, repo, REPOS } from './quick-switcher.fixture.ts';
import {
  createRepoStore,
  RECENT_KINDS,
  RECENT_LIMIT,
  REFRESH_INTERVAL_MS,
} from './repo-store.ts';
import type { RepoStore } from './repo-store.ts';

interface Setup {
  readonly store: RepoStore;
  readonly data: FakeWidgetData;
  readonly clock: { time: number };
  readonly changes: { count: number };
}

function setup(
  repos: () => Promise<DataResult<RepoSummary[]>> = async () => dataResult([...REPOS]),
  recent: () => Promise<DataResult<RecentRepoItem[]>> = async () =>
    dataResult([recentItem('acme/web')]),
): Setup {
  const data = createFakeWidgetData()
    .handle('repoIndex', repos)
    .handle('recentRepositories', recent);
  const clock = { time: NOW };
  const store = createRepoStore({ data, now: () => clock.time });
  const changes = { count: 0 };
  store.subscribe(() => {
    changes.count += 1;
  });
  return { store, data, clock, changes };
}

describe('createRepoStore', () => {
  it('starts empty and loads repositories and recent activity on the first refresh', async () => {
    const { store, data } = setup();
    assert.deepEqual(store.snapshot(), {
      index: null,
      loadError: null,
      loading: false,
      recent: [],
    });

    store.refresh();
    assert.equal(store.snapshot().loading, true);
    await flush();

    const snapshot = store.snapshot();
    assert.equal(snapshot.loading, false);
    assert.equal(snapshot.index?.repos.length, REPOS.length);
    assert.equal(snapshot.index?.searcher.size, REPOS.length);
    assert.deepEqual(snapshot.recent.map((item) => item.repo.name), ['web']);
    assert.deepEqual(data.callsTo('repoIndex'), [[undefined]]);
    assert.deepEqual(data.callsTo('recentRepositories'), [
      [{ kinds: RECENT_KINDS, limit: RECENT_LIMIT }],
    ]);
  });

  it('builds a searcher over the loaded repositories', async () => {
    const { store } = setup();
    store.refresh();
    await flush();
    const results = store.snapshot().index?.searcher.search('web') ?? [];
    assert.equal(results[0]?.repo.fullName, 'acme/web');
  });

  it('does not load again within the refresh interval', async () => {
    const { store, data, clock } = setup();
    store.refresh();
    await flush();
    clock.time += REFRESH_INTERVAL_MS - 1;
    store.refresh();
    await flush();
    assert.equal(data.callsTo('repoIndex').length, 1);
    assert.equal(data.callsTo('recentRepositories').length, 1);
  });

  it('refreshes in the background after the interval and keeps the old data', async () => {
    const { store, data, clock } = setup();
    store.refresh();
    await flush();
    const first = store.snapshot().index;
    clock.time += REFRESH_INTERVAL_MS;

    const next = deferred<DataResult<RepoSummary[]>>();
    data.handle('repoIndex', () => next.promise);
    store.refresh();
    assert.equal(store.snapshot().index, first);
    assert.equal(store.snapshot().loading, true);

    next.resolve(dataResult([repo('acme/new')], { fetchedAt: '2026-11-26T13:00:00.000Z' }));
    await flush();
    assert.deepEqual(
      store.snapshot().index?.repos.map((item) => item.fullName),
      ['acme/new'],
    );
    assert.equal(data.callsTo('recentRepositories').length, 2);
  });

  it('keeps the searcher when the refresh returns the same cached data', async () => {
    const { store, clock } = setup();
    store.refresh();
    await flush();
    const first = store.snapshot().index;
    clock.time += REFRESH_INTERVAL_MS;
    store.refresh();
    await flush();
    const second = store.snapshot().index;
    assert.notEqual(second, first);
    assert.equal(second?.searcher, first?.searcher);
    assert.equal(second?.repos, first?.repos);
  });

  it('does not start a second load while one is running', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const recent = deferred<DataResult<RecentRepoItem[]>>();
    const { store, data } = setup(
      () => pending.promise,
      () => recent.promise,
    );
    store.refresh();
    store.refresh(true);
    await flush();
    assert.equal(data.callsTo('repoIndex').length, 1);
    assert.equal(data.callsTo('recentRepositories').length, 1);
    pending.resolve(dataResult([...REPOS]));
    recent.resolve(dataResult([]));
    await flush();
  });

  it('forces a refresh past the cache when asked', async () => {
    const { store, data } = setup();
    store.refresh();
    await flush();
    store.refresh(true);
    await flush();
    assert.deepEqual(data.callsTo('repoIndex'), [[undefined], [{ forceRefresh: true }]]);
    assert.equal(data.callsTo('recentRepositories').length, 2);
  });

  it('reports a failed load and retries on the next refresh', async () => {
    let fail = true;
    const { store, data } = setup(async () => {
      if (fail) {
        throw new ApiError({ kind: 'no_tokens', message: 'none' });
      }
      return dataResult([...REPOS]);
    });
    store.refresh();
    await flush();
    assert.equal(store.snapshot().loadError?.kind, 'no_tokens');
    assert.equal(store.snapshot().index, null);
    assert.equal(store.snapshot().loading, false);

    fail = false;
    store.refresh();
    await flush();
    assert.equal(store.snapshot().loadError, null);
    assert.equal(store.snapshot().index?.repos.length, REPOS.length);
    assert.equal(data.callsTo('repoIndex').length, 2);
  });

  it('keeps the loaded repositories when a later refresh fails', async () => {
    const { store, data, clock } = setup();
    store.refresh();
    await flush();
    const index = store.snapshot().index;
    clock.time += REFRESH_INTERVAL_MS;
    data.handle('repoIndex', () => Promise.reject(new Error('gone')));
    store.refresh();
    await flush();
    assert.equal(store.snapshot().index, index);
    assert.equal(store.snapshot().loadError?.kind, 'internal');
  });

  it('treats a synchronously throwing data layer like a failed load', async () => {
    const { store } = setup(() => {
      throw new Error('boom');
    });
    store.refresh();
    await flush();
    assert.equal(store.snapshot().loadError?.kind, 'internal');
  });

  it('keeps partial errors next to the repositories', async () => {
    const error = { kind: 'unauthorized', message: 'bad', owner: 'globex' } as const;
    const { store } = setup(async () => dataResult([...REPOS], { errors: [error] }));
    store.refresh();
    await flush();
    assert.deepEqual(store.snapshot().index?.errors, [error]);
  });

  it('starts without recent repositories when they fail and retries them later', async () => {
    let fail = true;
    const { store, data } = setup(undefined, async () => {
      if (fail) {
        throw new Error('events unavailable');
      }
      return dataResult([recentItem('acme/web')]);
    });
    store.refresh();
    await flush();
    assert.deepEqual(store.snapshot().recent, []);
    assert.notEqual(store.snapshot().index, null);

    fail = false;
    store.refresh();
    await flush();
    assert.equal(store.snapshot().recent.length, 1);
    assert.equal(data.callsTo('recentRepositories').length, 2);
  });

  it('notifies subscribers on changes until they unsubscribe', async () => {
    const { store, changes } = setup();
    let own = 0;
    const off = store.subscribe(() => {
      own += 1;
    });
    store.refresh();
    await flush();
    assert.ok(own >= 2);
    assert.equal(changes.count, own);
    off();
    store.refresh(true);
    await flush();
    assert.ok(changes.count > own);
  });
});
