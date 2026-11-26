import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { FIXED_TIME, createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { IssueItem } from '../../shared/types.ts';
import type { Dispose, RefreshReason, WidgetContext } from '../../shared/widget.ts';
import { defaultIssueListConfig } from './config.ts';
import type { IssueListConfig } from './config.ts';
import { mountIssueList } from './issue-list-view.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const NOW = Date.parse(FIXED_TIME);

function issue(number: number, overrides: Partial<IssueItem> = {}): IssueItem {
  return {
    id: `I_${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/app/issues/${number}`,
    repo: { owner: 'acme', name: 'app' },
    author: null,
    state: 'open',
    stateReason: null,
    assignees: [],
    labels: [],
    commentCount: 0,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  readonly target: HTMLElement;
  readonly data: FakeWidgetData;
  readonly controller: AbortController;
  readonly openOptionsCalls: number[];
  readonly listeners: Set<(reason: RefreshReason) => void>;
  readonly context: WidgetContext<IssueListConfig>;
  refresh(reason: RefreshReason): void;
  mount(config?: Partial<IssueListConfig>): Dispose;
}

function createHarness(): Harness {
  const target = document.createElement('div');
  document.body.append(target);
  const data = createFakeWidgetData();
  const controller = new AbortController();
  const openOptionsCalls: number[] = [];
  const listeners = new Set<(reason: RefreshReason) => void>();
  const context: WidgetContext<IssueListConfig> = {
    instanceId: 'issues-1',
    data,
    signal: controller.signal,
    saveConfig: () => Promise.resolve(),
    onRefresh(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openOptions: () => openOptionsCalls.push(1),
  };
  return {
    target,
    data,
    controller,
    openOptionsCalls,
    listeners,
    context,
    refresh: (reason) => listeners.forEach((listener) => listener(reason)),
    mount: (config = {}) =>
      mountIssueList(target, context, { ...defaultIssueListConfig(), ...config }, {
        now: () => NOW,
      }),
  };
}

function titles(target: HTMLElement): string[] {
  return [...target.querySelectorAll('.ghx-row__title')].map((node) => node.textContent ?? '');
}

function buttonByLabel(target: HTMLElement, label: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  assert.ok(found, `button "${label}" exists`);
  return found;
}

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.target.remove();
});

describe('mountIssueList', () => {
  it('shows a loading state, then the issues', async () => {
    const response = deferred<DataResult<IssueItem[]>>();
    harness.data.handle('searchIssues', () => response.promise);
    harness.mount();

    const root = harness.target.querySelector('.ghx-issue-list');
    assert.ok(root);
    assert.ok(root.querySelector('.ghx-state--loading'));
    assert.equal(root.getAttribute('aria-busy'), 'true');

    response.resolve(dataResult([issue(1), issue(2)]));
    await flush();

    assert.equal(root.querySelector('.ghx-state--loading'), null);
    assert.equal(root.hasAttribute('aria-busy'), false);
    assert.deepEqual(titles(harness.target), ['Issue 1', 'Issue 2']);
    assert.equal(
      root.querySelector('.ghx-issue-list__items')?.getAttribute('aria-label'),
      'Assigned to me',
    );
    assert.ok(root.querySelector('.ghx-row__repo'));
    assert.equal(root.querySelector('.ghx-issue-list__stale'), null);
    assert.equal(root.querySelector('.ghx-issue-list__errors'), null);
  });

  it('searches with the configured query and limit', async () => {
    harness.mount({ query: 'label:bug', limit: 5 });
    await flush();

    assert.deepEqual(harness.data.callsTo('searchIssues'), [
      ['label:bug', { limit: 5, forceRefresh: false }],
    ]);
    assert.deepEqual(harness.data.callsTo('subscribedIssues'), []);
  });

  it('loads subscribed issues for the subscribed source', async () => {
    harness.data.handle('subscribedIssues', () => Promise.resolve(dataResult([issue(3)])));
    harness.mount({ source: 'subscribed', query: '', limit: 20 });
    await flush();

    assert.deepEqual(harness.data.callsTo('subscribedIssues'), [
      [{ limit: 20, forceRefresh: false }],
    ]);
    assert.deepEqual(harness.data.callsTo('searchIssues'), []);
    assert.deepEqual(titles(harness.target), ['Issue 3']);
    const link = harness.target.querySelector<HTMLAnchorElement>('.ghx-issue-list__view-all');
    assert.equal(link?.href, 'https://github.com/notifications/subscriptions');
  });

  it('never renders more issues than the limit', async () => {
    const many = Array.from({ length: 8 }, (_, index) => issue(index + 1));
    harness.data.handle('searchIssues', () => Promise.resolve(dataResult(many)));
    harness.mount({ limit: 5 });
    await flush();

    assert.equal(titles(harness.target).length, 5);
  });

  it('hides the repository when configured', async () => {
    harness.data.handle('searchIssues', () => Promise.resolve(dataResult([issue(1)])));
    harness.mount({ showRepo: false });
    await flush();

    assert.equal(harness.target.querySelector('.ghx-row__repo'), null);
  });

  it('links all search results on GitHub', async () => {
    harness.mount({ query: 'label:bug' });
    await flush();

    const link = harness.target.querySelector<HTMLAnchorElement>('.ghx-issue-list__view-all');
    assert.equal(link?.textContent, 'View all on GitHub');
    assert.equal(link.href, 'https://github.com/issues?q=is%3Aissue%20label%3Abug');
  });

  it('shows an empty state for searches', async () => {
    harness.mount();
    await flush();

    const empty = harness.target.querySelector('.ghx-state--empty');
    assert.equal(empty?.querySelector('.ghx-state__title')?.textContent, 'No issues found');
    assert.ok(harness.target.querySelector('.ghx-issue-list__footer'));
  });

  it('shows an empty state for watched issues', async () => {
    harness.mount({ source: 'subscribed', query: '' });
    await flush();

    const empty = harness.target.querySelector('.ghx-state--empty');
    assert.equal(empty?.querySelector('.ghx-state__title')?.textContent, 'No watched issues');
  });

  it('marks stale results', async () => {
    harness.data.handle('searchIssues', () =>
      Promise.resolve(
        dataResult([issue(1)], { stale: true, fetchedAt: '2026-11-26T11:00:00.000Z' }),
      ),
    );
    harness.mount();
    await flush();

    const stale = harness.target.querySelector('.ghx-issue-list__stale');
    assert.equal(stale?.textContent, 'Outdated, fetched 1 hour ago');
    assert.deepEqual(titles(harness.target), ['Issue 1']);
  });

  it('shows partial errors compactly above the results', async () => {
    harness.data.handle('searchIssues', () =>
      Promise.resolve(
        dataResult([issue(1)], {
          errors: [{ kind: 'unauthorized', message: 'Bad credentials', owner: 'acme' }],
        }),
      ),
    );
    harness.mount();
    await flush();

    const errors = harness.target.querySelector('.ghx-issue-list__errors');
    assert.ok(errors);
    assert.equal(
      errors.querySelector('.ghx-state__title')?.textContent,
      'Some issues could not be loaded',
    );
    assert.equal(
      errors.querySelector('.ghx-error__text')?.textContent,
      'The token for acme is invalid or has expired.',
    );
    assert.ok(errors.nextElementSibling?.classList.contains('ghx-issue-list__items'));
    assert.deepEqual(titles(harness.target), ['Issue 1']);

    buttonByLabel(errors as HTMLElement, 'Open settings').click();
    assert.equal(harness.openOptionsCalls.length, 1);
  });

  it('shows an error state when errors leave no results', async () => {
    harness.data.handle('searchIssues', () =>
      Promise.resolve(dataResult([], { errors: [{ kind: 'network', message: 'offline' }] })),
    );
    harness.mount();
    await flush();

    assert.equal(harness.target.querySelector('.ghx-issue-list__errors'), null);
    assert.equal(harness.target.querySelector('.ghx-state--empty'), null);
    const state = harness.target.querySelector('.ghx-state--error');
    assert.equal(state?.querySelector('.ghx-state__title')?.textContent, 'Could not load issues');
    assert.ok(harness.target.querySelector('.ghx-issue-list__view-all'));
  });

  it('shows an error state with retry when the request is rejected', async () => {
    let attempt = 0;
    harness.data.handle('searchIssues', () => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new ApiError({ kind: 'no_tokens', message: 'none' }))
        : Promise.resolve(dataResult([issue(7)]));
    });
    harness.mount();
    await flush();

    const state = harness.target.querySelector<HTMLElement>('.ghx-state--error');
    assert.ok(state);
    assert.equal(
      state.querySelector('.ghx-error__text')?.textContent,
      'No access token is configured yet.',
    );
    assert.equal(harness.target.querySelector('.ghx-issue-list__footer'), null);
    buttonByLabel(state, 'Open settings').click();
    assert.equal(harness.openOptionsCalls.length, 1);

    buttonByLabel(state, 'Retry').click();
    await flush();

    assert.deepEqual(harness.data.callsTo('searchIssues')[1], [
      'is:open archived:false assignee:@me',
      { limit: 10, forceRefresh: true },
    ]);
    assert.deepEqual(titles(harness.target), ['Issue 7']);
    assert.equal(harness.target.querySelector('.ghx-state--error'), null);
  });

  it('maps unknown rejections to an internal error', async () => {
    harness.data.handle('searchIssues', () => Promise.reject(new Error('boom')));
    harness.mount();
    await flush();

    assert.equal(
      harness.target.querySelector('.ghx-error__text')?.textContent,
      'Something went wrong.',
    );
  });

  it('keeps the previous list while refreshing', async () => {
    const responses = [deferred<DataResult<IssueItem[]>>(), deferred<DataResult<IssueItem[]>>()];
    let call = 0;
    harness.data.handle('searchIssues', () => {
      const response = responses[call];
      call += 1;
      assert.ok(response);
      return response.promise;
    });
    harness.mount();
    responses[0]?.resolve(dataResult([issue(1)]));
    await flush();
    const list = harness.target.querySelector('.ghx-issue-list__items');

    harness.refresh('interval');
    const root = harness.target.querySelector('.ghx-issue-list');
    assert.equal(root?.getAttribute('aria-busy'), 'true');
    assert.equal(harness.target.querySelector('.ghx-issue-list__items'), list);
    assert.equal(harness.target.querySelector('.ghx-state--loading'), null);

    responses[1]?.resolve(dataResult([issue(2), issue(1)]));
    await flush();

    assert.deepEqual(titles(harness.target), ['Issue 2', 'Issue 1']);
    assert.equal(root?.hasAttribute('aria-busy'), false);
  });

  it('bypasses the cache only for manual refreshes', async () => {
    harness.mount();
    await flush();
    harness.refresh('visible');
    harness.refresh('interval');
    harness.refresh('manual');
    await flush();

    assert.deepEqual(
      harness.data.callsTo('searchIssues').map((args) => args[1]),
      [false, false, false, true].map((forceRefresh) => ({ limit: 10, forceRefresh })),
    );
  });

  it('keeps the previous list and marks it outdated when a refresh is rejected', async () => {
    let attempt = 0;
    harness.data.handle('searchIssues', () => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(dataResult([issue(1)]))
        : Promise.reject(new ApiError({ kind: 'network', message: 'offline' }));
    });
    harness.mount();
    await flush();
    harness.refresh('manual');
    await flush();

    assert.deepEqual(titles(harness.target), ['Issue 1']);
    const errors = harness.target.querySelector<HTMLElement>('.ghx-issue-list__errors');
    assert.equal(
      errors?.querySelector('.ghx-error__text')?.textContent,
      'GitHub could not be reached. Check your connection.',
    );
    assert.ok(harness.target.querySelector('.ghx-issue-list__stale'));
    assert.ok(errors);
    assert.ok(buttonByLabel(errors, 'Retry'));
  });

  it('shows only the error state when a refresh of an empty result is rejected', async () => {
    let attempt = 0;
    harness.data.handle('searchIssues', () => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(dataResult([]))
        : Promise.reject(new ApiError({ kind: 'network', message: 'offline' }));
    });
    harness.mount();
    await flush();
    harness.refresh('interval');
    await flush();

    assert.equal(harness.target.querySelector('.ghx-state--empty'), null);
    assert.ok(harness.target.querySelector('.ghx-state--error'));
    assert.ok(harness.target.querySelector('.ghx-issue-list__stale'));
  });

  it('ignores responses that were overtaken by a newer request', async () => {
    const first = deferred<DataResult<IssueItem[]>>();
    const second = deferred<DataResult<IssueItem[]>>();
    const queue = [first, second];
    harness.data.handle('searchIssues', () => {
      const next = queue.shift();
      assert.ok(next);
      return next.promise;
    });
    harness.mount();
    harness.refresh('manual');

    second.resolve(dataResult([issue(2)]));
    await flush();
    first.resolve(dataResult([issue(1)]));
    await flush();

    assert.deepEqual(titles(harness.target), ['Issue 2']);
  });

  it('ignores overtaken rejections', async () => {
    const first = deferred<DataResult<IssueItem[]>>();
    const queue = [first.promise, Promise.resolve(dataResult([issue(2)]))];
    harness.data.handle('searchIssues', () => {
      const next = queue.shift();
      assert.ok(next);
      return next;
    });
    harness.mount();
    harness.refresh('manual');
    await flush();
    first.reject(new Error('late'));
    await flush();

    assert.deepEqual(titles(harness.target), ['Issue 2']);
    assert.equal(harness.target.querySelector('.ghx-state--error'), null);
  });

  it('ignores responses after the signal was aborted', async () => {
    const response = deferred<DataResult<IssueItem[]>>();
    harness.data.handle('searchIssues', () => response.promise);
    harness.mount();
    harness.controller.abort();
    response.resolve(dataResult([issue(1)]));
    await flush();

    assert.ok(harness.target.querySelector('.ghx-state--loading'));
  });

  it('removes its content and stops listening on dispose', async () => {
    const response = deferred<DataResult<IssueItem[]>>();
    harness.data.handle('searchIssues', () => response.promise);
    const dispose = harness.mount();
    assert.equal(harness.listeners.size, 1);

    dispose();
    response.reject(new Error('late'));
    await flush();

    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.target.childElementCount, 0);
  });
});
