import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { PullRequestItem } from '../../shared/types.ts';
import type { Dispose } from '../../shared/widget.ts';
import { defaultPullRequestListConfig } from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';
import { mountPullRequestList } from './pr-list-view.ts';
import {
  createTestContext,
  deferred,
  flush,
  NOW,
  pullRequest,
  pullRequests,
} from './pr-list.fixture.ts';
import type { Deferred, TestContext } from './pr-list.fixture.ts';

type Result = DataResult<PullRequestItem[]>;

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('mountPullRequestList', () => {
  let data: FakeWidgetData;
  let test: TestContext;
  let target: HTMLElement;
  let pending: Deferred<Result>[];

  beforeEach(() => {
    data = createFakeWidgetData();
    pending = [];
    data.handle('searchPullRequests', () => {
      const next = deferred<Result>();
      pending.push(next);
      return next.promise;
    });
    test = createTestContext(data);
    target = document.createElement('div');
  });

  function mount(overrides: Partial<PullRequestListConfig> = {}): Dispose {
    const config = { ...defaultPullRequestListConfig(), ...overrides };
    return mountPullRequestList(target, test.context, config, () => NOW);
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
    const element = target.querySelector<HTMLElement>('.ghx-pr-list');
    assert.ok(element);
    return element;
  };
  const titles = (): string[] =>
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

  it('shows a loading state and requests the configured query', () => {
    mount({ query: 'is:open org:acme', limit: 20 });

    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.ok(target.querySelector('.ghx-state--loading'));
    assert.equal(target.textContent, 'Loading pull requests...');
    assert.deepEqual(data.callsTo('searchPullRequests'), [
      ['is:open org:acme', { limit: 20, forceRefresh: false }],
    ]);
  });

  it('renders pull request rows with repository and a footer link', async () => {
    mount();
    await answer(0, dataResult([pullRequest({ title: 'First' }), pullRequest({ id: 'PR_2' })]));

    assert.equal(root().hasAttribute('aria-busy'), false);
    assert.equal(target.querySelector('.ghx-state'), null);
    assert.equal(target.querySelector('ul.ghx-list')?.getAttribute('aria-label'), 'Pull requests');
    assert.deepEqual(titles(), ['First', 'Add widgets']);
    assert.equal(target.querySelectorAll('.ghx-row__repo').length, 2);
    assert.equal(target.querySelector('.ghx-row time')?.textContent, '1 hour ago');
    const all = target.querySelector<HTMLAnchorElement>('.ghx-pr-list__footer a.ghx-pr-list__all');
    assert.equal(all?.textContent, 'View all on GitHub');
    assert.equal(
      all?.getAttribute('href'),
      'https://github.com/pulls?q=is%3Apr%20is%3Aopen%20archived%3Afalse%20review-requested%3A%40me',
    );
    assert.equal(target.querySelector('.ghx-pr-list__stale'), null);
    assert.equal(target.querySelector('.ghx-pr-list__errors'), null);
  });

  it('hides the repository when configured', async () => {
    mount({ showRepo: false });
    await answer(0, dataResult([pullRequest()]));

    assert.equal(target.querySelector('.ghx-row__repo'), null);
  });

  it('shows at most the configured number of rows', async () => {
    mount({ limit: 5 });
    await answer(0, dataResult(pullRequests(7)));

    assert.equal(titles().length, 5);
  });

  it('shows an empty state with the query', async () => {
    mount({ query: 'is:open author:nobody' });
    await answer(0, dataResult([]));

    assert.equal(stateTitle(), 'No pull requests match');
    const code = target.querySelector('.ghx-state__description code');
    assert.equal(code?.textContent, 'is:open author:nobody');
    assert.ok(target.querySelector('.ghx-pr-list__all'));
  });

  it('shows partial errors compactly above the list', async () => {
    mount();
    await answer(
      0,
      dataResult([pullRequest()], {
        errors: [{ kind: 'unauthorized', message: 'Bad credentials', owner: 'acme' }],
      }),
    );

    const errors = target.querySelector('.ghx-pr-list__errors');
    assert.ok(errors);
    assert.equal(errors.nextElementSibling?.tagName, 'UL');
    assert.equal(stateTitle(), 'Some pull requests could not be loaded');
    assert.match(errors.textContent ?? '', /The token for acme is invalid or has expired/);
    assert.deepEqual(titles(), ['Add widgets']);

    buttonByLabel('Open settings').click();
    assert.equal(test.openOptionsCalls(), 1);
  });

  it('shows an error state when only errors come back', async () => {
    mount();
    await answer(0, dataResult([], { errors: [{ kind: 'network', message: 'offline' }] }));

    assert.equal(target.querySelector('.ghx-pr-list__errors'), null);
    assert.ok(target.querySelector('.ghx-state--error'));
    assert.equal(stateTitle(), 'Could not load pull requests');
    assert.throws(() => buttonByLabel('Open settings'));
    assert.ok(target.querySelector('.ghx-pr-list__all'));
  });

  it('shows an error state with retry when the request is rejected', async () => {
    mount();
    await fail(0, new ApiError({ kind: 'no_tokens', message: 'No tokens' }));

    assert.equal(stateTitle(), 'Could not load pull requests');
    assert.match(target.textContent ?? '', /No access token is configured yet/);
    assert.equal(root().hasAttribute('aria-busy'), false);

    buttonByLabel('Open settings').click();
    assert.equal(test.openOptionsCalls(), 1);

    buttonByLabel('Retry').click();
    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.deepEqual(data.callsTo('searchPullRequests')[1], [
      defaultPullRequestListConfig().query,
      { limit: 10, forceRefresh: true },
    ]);
    await answer(1, dataResult([pullRequest()]));
    assert.deepEqual(titles(), ['Add widgets']);
    assert.equal(target.querySelector('.ghx-state--error'), null);
  });

  it('describes unknown rejections as internal errors', async () => {
    mount();
    await fail(0, new Error('boom'));

    assert.match(target.textContent ?? '', /Something went wrong/);
  });

  it('keeps the earlier list when a refresh is rejected', async () => {
    mount();
    await answer(0, dataResult([pullRequest()], { fetchedAt: '2026-11-26T11:55:00.000Z' }));
    test.refresh('interval');
    await fail(1, new ApiError({ kind: 'network', message: 'offline' }));

    assert.deepEqual(titles(), ['Add widgets']);
    assert.equal(stateTitle(), 'Could not refresh pull requests');
    const stale = target.querySelector('.ghx-pr-list__stale');
    assert.equal(stale?.textContent, 'Updated 5 minutes ago');
  });

  it('marks stale results', async () => {
    mount();
    await answer(
      0,
      dataResult([pullRequest()], { stale: true, fetchedAt: '2026-11-26T10:00:00.000Z' }),
    );

    const stale = target.querySelector<HTMLElement>('.ghx-pr-list__stale');
    assert.equal(stale?.textContent, 'Updated 2 hours ago');
    assert.ok(stale?.title);
    assert.equal(stale?.parentElement?.className, 'ghx-pr-list__footer');
  });

  it('keeps the old list while refreshing, manual refreshes bypass the cache', async () => {
    mount();
    await answer(0, dataResult([pullRequest({ title: 'Old' })]));

    test.refresh('interval');
    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.deepEqual(titles(), ['Old']);
    await answer(1, dataResult([pullRequest({ title: 'New' })]));
    assert.deepEqual(titles(), ['New']);

    test.refresh('visible');
    test.refresh('manual');
    assert.deepEqual(
      data.callsTo('searchPullRequests').map((args) => args[1]),
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
    await answer(1, dataResult([pullRequest({ title: 'Newer' })]));
    await answer(0, dataResult([pullRequest({ title: 'Older' })]));

    assert.deepEqual(titles(), ['Newer']);
    assert.equal(root().hasAttribute('aria-busy'), false);
  });

  it('ignores responses after dispose and stops listening for refreshes', async () => {
    const dispose = mount();
    assert.equal(test.listenerCount(), 1);

    dispose();
    assert.equal(target.childElementCount, 0);
    assert.equal(test.listenerCount(), 0);
    await answer(0, dataResult([pullRequest()]));
    assert.equal(target.childElementCount, 0);
  });

  it('ignores responses after the signal was aborted', async () => {
    mount();
    test.controller.abort();
    await answer(0, dataResult([pullRequest()]));

    assert.ok(target.querySelector('.ghx-state--loading'));
  });
});
