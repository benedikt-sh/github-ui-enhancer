import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RecentRepoItem } from '../../shared/types.ts';
import type { Dispose } from '../../shared/widget.ts';
import { defaultRecentReposConfig } from './recent-repos-config.ts';
import type { RecentReposConfig } from './recent-repos-config.ts';
import { mountRecentRepos } from './recent-repos-view.ts';
import {
  createTestContext,
  deferred,
  flush,
  NOW,
  recentRepo,
  recentRepos,
} from './recent-repos.fixture.ts';
import type { Deferred, TestContext } from './recent-repos.fixture.ts';

type Result = DataResult<RecentRepoItem[]>;

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('mountRecentRepos', () => {
  let data: FakeWidgetData;
  let test: TestContext;
  let target: HTMLElement;
  let pending: Deferred<Result>[];

  beforeEach(() => {
    data = createFakeWidgetData();
    pending = [];
    data.handle('recentRepositories', () => {
      const next = deferred<Result>();
      pending.push(next);
      return next.promise;
    });
    test = createTestContext(data);
    target = document.createElement('div');
  });

  function mount(overrides: Partial<RecentReposConfig> = {}): Dispose {
    const config = { ...defaultRecentReposConfig(), ...overrides };
    return mountRecentRepos(target, test.context, config, () => NOW);
  }

  function request(index: number): Deferred<Result> {
    const entry = pending[index];
    assert.ok(entry, `request ${index} was not sent`);
    return entry;
  }

  async function answer(index: number, result: Result): Promise<void> {
    request(index).resolve(result);
    await flush();
  }

  async function fail(index: number, error: unknown): Promise<void> {
    request(index).reject(error);
    await flush();
  }

  const root = (): HTMLElement => {
    const element = target.querySelector<HTMLElement>('.ghx-recent-repos');
    assert.ok(element);
    return element;
  };
  const repos = (): string[] =>
    [...target.querySelectorAll('.ghx-row__title')].map((row) => row.textContent ?? '');
  const stateTitle = (): string | null =>
    target.querySelector('.ghx-state__title')?.textContent ?? null;
  const buttonByLabel = (label: string): HTMLButtonElement => {
    const button = [...target.querySelectorAll('button')].find(
      (element) => element.textContent === label,
    );
    assert.ok(button, `button "${label}" not found`);
    return button;
  };

  it('shows a loading state and requests code activity by default', () => {
    mount();

    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.ok(target.querySelector('.ghx-state--loading'));
    assert.equal(target.textContent, 'Loading recent repositories...');
    assert.deepEqual(data.callsTo('recentRepositories'), [
      [{ limit: 10, forceRefresh: false, kinds: ['push', 'pull_request', 'create'] }],
    ]);
  });

  it('requests every kind for all activity', () => {
    mount({ activity: 'all', limit: 20 });

    assert.deepEqual(data.callsTo('recentRepositories'), [[{ limit: 20, forceRefresh: false }]]);
  });

  it('renders repository rows', async () => {
    mount();
    const second = recentRepo({ repo: { owner: 'acme', name: 'api' } });
    await answer(0, dataResult([recentRepo(), second]));

    assert.equal(root().hasAttribute('aria-busy'), false);
    assert.equal(target.querySelector('.ghx-state'), null);
    const list = target.querySelector('ul.ghx-list');
    assert.equal(list?.getAttribute('aria-label'), 'Recent repositories');
    assert.deepEqual(repos(), ['octo/repo', 'acme/api']);
    assert.equal(target.querySelector('.ghx-row time')?.textContent, '1 hour ago');
    assert.equal(target.querySelector('.ghx-recent-repos__footer'), null);
    assert.equal(target.querySelector('.ghx-recent-repos__errors'), null);
  });

  it('shows at most the configured number of rows', async () => {
    mount({ limit: 5 });
    await answer(0, dataResult(recentRepos(7)));

    assert.equal(repos().length, 5);
  });

  it('shows an empty state that explains the event window', async () => {
    mount({ activity: 'all' });
    await answer(0, dataResult([]));

    assert.equal(stateTitle(), 'No recent activity found.');
    assert.equal(
      target.querySelector('.ghx-state__description')?.textContent,
      'GitHub keeps your events for up to 90 days.',
    );
  });

  it('names the counted activities in the empty state for code changes', async () => {
    mount();
    await answer(0, dataResult([]));

    assert.match(
      target.querySelector('.ghx-state__description')?.textContent ?? '',
      /^Only pushes, pull requests and created branches count\. GitHub keeps your events/,
    );
  });

  it('shows partial errors compactly above the list', async () => {
    mount();
    await answer(
      0,
      dataResult([recentRepo()], {
        errors: [{ kind: 'unauthorized', message: 'Bad credentials', owner: 'acme' }],
      }),
    );

    const errors = target.querySelector('.ghx-recent-repos__errors');
    assert.ok(errors);
    assert.equal(errors.nextElementSibling?.tagName, 'UL');
    assert.equal(stateTitle(), 'Some activity could not be loaded');
    assert.match(errors.textContent ?? '', /The token for acme is invalid or has expired/);
    assert.deepEqual(repos(), ['octo/repo']);

    buttonByLabel('Open settings').click();
    assert.equal(test.openOptionsCalls(), 1);
  });

  it('shows an error state when only errors come back', async () => {
    mount();
    await answer(0, dataResult([], { errors: [{ kind: 'network', message: 'offline' }] }));

    assert.equal(target.querySelector('.ghx-recent-repos__errors'), null);
    assert.ok(target.querySelector('.ghx-state--error'));
    assert.equal(stateTitle(), 'Could not load recent repositories');
    assert.throws(() => buttonByLabel('Open settings'));
  });

  it('shows an error state with retry when the request is rejected', async () => {
    mount();
    await fail(0, new ApiError({ kind: 'no_tokens', message: 'No tokens' }));

    assert.equal(stateTitle(), 'Could not load recent repositories');
    assert.match(target.textContent ?? '', /No access token is configured yet/);
    assert.equal(root().hasAttribute('aria-busy'), false);
    assert.equal(target.querySelector('.ghx-recent-repos__footer'), null);

    buttonByLabel('Open settings').click();
    assert.equal(test.openOptionsCalls(), 1);

    buttonByLabel('Retry').click();
    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.deepEqual(data.callsTo('recentRepositories')[1], [
      { limit: 10, forceRefresh: true, kinds: ['push', 'pull_request', 'create'] },
    ]);
    await answer(1, dataResult([recentRepo()]));
    assert.deepEqual(repos(), ['octo/repo']);
    assert.equal(target.querySelector('.ghx-state--error'), null);
  });

  it('describes unknown rejections as internal errors', async () => {
    mount();
    await fail(0, new Error('boom'));

    assert.match(target.textContent ?? '', /Something went wrong/);
  });

  it('keeps the earlier list when a refresh is rejected', async () => {
    mount();
    await answer(0, dataResult([recentRepo()], { fetchedAt: '2026-11-26T11:55:00.000Z' }));
    test.refresh('interval');
    await fail(1, new ApiError({ kind: 'network', message: 'offline' }));

    assert.deepEqual(repos(), ['octo/repo']);
    assert.equal(stateTitle(), 'Could not refresh recent repositories');
    const stale = target.querySelector('.ghx-recent-repos__stale');
    assert.equal(stale?.textContent, 'Updated 5 minutes ago');
  });

  it('marks stale results', async () => {
    mount();
    await answer(
      0,
      dataResult([recentRepo()], { stale: true, fetchedAt: '2026-11-26T10:00:00.000Z' }),
    );

    const stale = target.querySelector<HTMLElement>('.ghx-recent-repos__stale');
    assert.equal(stale?.textContent, 'Updated 2 hours ago');
    assert.ok(stale?.title);
    assert.equal(stale?.parentElement?.className, 'ghx-recent-repos__footer');
  });

  it('marks a stale empty result', async () => {
    mount();
    await answer(0, dataResult([], { stale: true, fetchedAt: '2026-11-26T10:00:00.000Z' }));

    assert.equal(stateTitle(), 'No recent activity found.');
    const stale = target.querySelector('.ghx-recent-repos__stale');
    assert.equal(stale?.textContent, 'Updated 2 hours ago');
  });

  it('keeps the old list while refreshing, manual refreshes bypass the cache', async () => {
    mount({ activity: 'all' });
    await answer(0, dataResult([recentRepo({ repo: { owner: 'octo', name: 'old' } })]));

    test.refresh('interval');
    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.deepEqual(repos(), ['octo/old']);
    await answer(1, dataResult([recentRepo({ repo: { owner: 'octo', name: 'new' } })]));
    assert.deepEqual(repos(), ['octo/new']);

    test.refresh('visible');
    test.refresh('manual');
    assert.deepEqual(
      data.callsTo('recentRepositories').map((args) => args[0]),
      [
        { limit: 10, forceRefresh: false },
        { limit: 10, forceRefresh: false },
        { limit: 10, forceRefresh: false },
        { limit: 10, forceRefresh: true },
      ],
    );
  });

  it('ignores responses that were overtaken by a newer request', async () => {
    mount();
    test.refresh('manual');
    await answer(1, dataResult([recentRepo({ repo: { owner: 'octo', name: 'newer' } })]));
    await answer(0, dataResult([recentRepo({ repo: { owner: 'octo', name: 'older' } })]));

    assert.deepEqual(repos(), ['octo/newer']);
    assert.equal(root().hasAttribute('aria-busy'), false);
  });

  it('ignores responses after dispose and stops listening for refreshes', async () => {
    const dispose = mount();
    assert.equal(test.listenerCount(), 1);

    dispose();
    assert.equal(target.childElementCount, 0);
    assert.equal(test.listenerCount(), 0);
    await answer(0, dataResult([recentRepo()]));
    assert.equal(target.childElementCount, 0);
  });

  it('ignores responses after the signal was aborted', async () => {
    mount();
    test.controller.abort();
    await answer(0, dataResult([recentRepo()]));

    assert.ok(target.querySelector('.ghx-state--loading'));
  });
});
