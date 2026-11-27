import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { PullRequestItem, RepoRef } from '../../shared/types.ts';
import type { Dispose } from '../../shared/widget.ts';
import { defaultDependabotPrsConfig } from './dependabot-prs-config.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';
import { dependabotQuery, dependabotSearchUrl } from './dependabot-prs-search.ts';
import { EMPTY_TITLE, groupByRepo, mountDependabotPrs } from './dependabot-prs-view.ts';
import {
  buttonByText,
  createTestContext,
  deferred,
  flush,
  NOW,
  pullRequest,
  repo,
  repoSummary,
  typeInto,
} from './dependabot-prs.fixture.ts';
import type { Deferred, TestContext } from './dependabot-prs.fixture.ts';

type Result = DataResult<PullRequestItem[]>;

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPOS: readonly RepoRef[] = [repo('octo/api'), repo('acme/web')];

describe('groupByRepo', () => {
  it('groups case-insensitively in the order of the first item', () => {
    const items = [
      pullRequest({ id: 'A', repo: repo('acme/web') }),
      pullRequest({ id: 'B', repo: repo('octo/api') }),
      pullRequest({ id: 'C', repo: repo('Acme/Web') }),
    ];
    assert.deepEqual(
      groupByRepo(items).map((group) => [group.repo, group.items.map((item) => item.id)]),
      [
        [repo('acme/web'), ['A', 'C']],
        [repo('octo/api'), ['B']],
      ],
    );
  });
});

describe('mountDependabotPrs', () => {
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
    data.handle('repoIndex', async () =>
      dataResult([repoSummary('octo/api'), repoSummary('acme/web')]),
    );
    test = createTestContext(data);
    target = document.createElement('div');
    document.body.replaceChildren(target);
  });

  function mount(overrides: Partial<DependabotPrsConfig> = {}): Dispose {
    const config = { ...defaultDependabotPrsConfig(), repos: REPOS, ...overrides };
    return mountDependabotPrs(target, test.context, config, () => NOW);
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
    const element = target.querySelector<HTMLElement>('.ghx-dependabot-prs');
    assert.ok(element);
    return element;
  };
  const titles = (): string[] =>
    [...target.querySelectorAll('.ghx-row__title')].map((row) => row.textContent ?? '');
  const stateTitle = (): string | null =>
    target.querySelector('.ghx-state__title')?.textContent ?? null;

  it('shows a loading state and searches the repositories', () => {
    mount({ limit: 20 });

    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.equal(target.querySelector('.ghx-state--loading')?.textContent, 'Loading pull requests...');
    assert.deepEqual(data.callsTo('searchPullRequests'), [
      [dependabotQuery(REPOS), { limit: 20, forceRefresh: false }],
    ]);
  });

  it('renders rows with repository and a footer link', async () => {
    mount();
    await answer(
      0,
      dataResult([
        pullRequest({ id: 'A', title: 'Bump a' }),
        pullRequest({ id: 'B', title: 'Bump b', repo: repo('acme/web') }),
      ]),
    );

    assert.equal(root().hasAttribute('aria-busy'), false);
    assert.deepEqual(titles(), ['Bump a', 'Bump b']);
    assert.equal(target.querySelectorAll('.ghx-row__repo').length, 2);
    assert.equal(
      target.querySelector('ul.ghx-list')?.getAttribute('aria-label'),
      'Dependabot pull requests',
    );
    const all = target.querySelector<HTMLAnchorElement>('.ghx-dependabot-prs__footer a');
    assert.equal(all?.textContent, 'View on GitHub');
    assert.equal(all?.getAttribute('href'), dependabotSearchUrl(REPOS));
    assert.equal(target.querySelector('.ghx-dependabot-prs__stale'), null);
    assert.equal(target.querySelector('.ghx-dependabot-prs__errors'), null);
  });

  it('groups rows by repository with a header and count', async () => {
    mount({ groupByRepo: true, limit: 5 });
    await answer(
      0,
      dataResult([
        pullRequest({ id: 'A', title: 'a1', repo: repo('acme/web') }),
        pullRequest({ id: 'B', title: 'o1' }),
        pullRequest({ id: 'C', title: 'a2', repo: repo('acme/web') }),
      ]),
    );

    const groups = [...target.querySelectorAll('.ghx-dependabot-prs__group')];
    assert.equal(groups.length, 2);
    const header = (index: number): string =>
      groups[index]?.querySelector('.ghx-dependabot-prs__group-header .ghx-row__repo')
        ?.textContent ?? '';
    const count = (index: number): Element | null =>
      groups[index]?.querySelector('.ghx-counter') ?? null;
    assert.equal(header(0), 'acme/web');
    assert.equal(count(0)?.textContent, '2');
    assert.equal(count(0)?.getAttribute('aria-label'), '2 pull requests');
    assert.equal(header(1), 'octo/api');
    assert.equal(count(1)?.getAttribute('aria-label'), '1 pull request');
    assert.equal(
      groups[0]?.querySelector('ul.ghx-list')?.getAttribute('aria-label'),
      'Pull requests in acme/web',
    );
    assert.deepEqual(titles(), ['a1', 'a2', 'o1']);
    assert.equal(target.querySelector('.ghx-row .ghx-row__repo'), null);
  });

  it('applies the limit', async () => {
    mount({ limit: 5 });
    const items = Array.from({ length: 7 }, (_, index) => pullRequest({ id: `PR_${index}` }));
    await answer(0, dataResult(items));

    assert.equal(titles().length, 5);
  });

  it('shows an empty state', async () => {
    mount();
    await answer(0, dataResult([]));

    assert.equal(stateTitle(), EMPTY_TITLE);
    assert.ok(target.querySelector('.ghx-dependabot-prs__footer a'));
  });

  it('shows errors without data with settings and retry', async () => {
    mount();
    await answer(0, dataResult([], { errors: [{ kind: 'unauthorized', message: 'bad' }] }));

    assert.equal(stateTitle(), 'Could not load Dependabot pull requests');
    buttonByText(target, 'Open settings').click();
    assert.equal(test.openOptionsCalls(), 1);

    buttonByText(target, 'Retry').click();
    assert.deepEqual(data.callsTo('searchPullRequests')[1]?.[1], { limit: 10, forceRefresh: true });
  });

  it('shows compact errors above partial data', async () => {
    mount();
    await answer(
      0,
      dataResult([pullRequest()], { errors: [{ kind: 'forbidden', message: 'no', owner: 'acme' }] }),
    );

    const errors = target.querySelector('.ghx-dependabot-prs__errors');
    assert.equal(
      errors?.querySelector('.ghx-state__title')?.textContent,
      'Some pull requests could not be loaded',
    );
    assert.ok(buttonByText(errors as HTMLElement, 'Open settings'));
    assert.deepEqual(titles(), ['Bump lodash from 4.17.20 to 4.17.21']);
  });

  it('shows a rejected request as error with retry', async () => {
    mount();
    await fail(0, new ApiError({ kind: 'network', message: 'offline' }));

    assert.equal(stateTitle(), 'Could not load Dependabot pull requests');
    assert.equal(root().hasAttribute('aria-busy'), false);
    assert.throws(() => buttonByText(target, 'Open settings'));
    buttonByText(target, 'Retry').click();
    assert.equal(pending.length, 2);
    await answer(1, dataResult([pullRequest()]));
    assert.equal(titles().length, 1);
  });

  it('keeps the earlier list when a refresh is rejected and marks it stale', async () => {
    mount();
    await answer(0, dataResult([pullRequest()], { fetchedAt: '2026-11-26T11:00:00.000Z' }));
    test.refresh('interval');
    await fail(1, new Error('boom'));

    assert.deepEqual(titles(), ['Bump lodash from 4.17.20 to 4.17.21']);
    assert.equal(
      target.querySelector('.ghx-dependabot-prs__errors .ghx-state__title')?.textContent,
      'Could not refresh pull requests',
    );
    assert.equal(target.querySelector('.ghx-dependabot-prs__stale time')?.textContent, '1 hour ago');
  });

  it('shows a stale marker for stale data', async () => {
    mount();
    await answer(
      0,
      dataResult([pullRequest()], { stale: true, fetchedAt: '2026-11-26T10:00:00.000Z' }),
    );

    const stale = target.querySelector('.ghx-dependabot-prs__stale');
    assert.equal(stale?.textContent, 'Updated 2 hours ago');
  });

  it('refreshes without flicker and forces manual refreshes', async () => {
    mount();
    await answer(0, dataResult([pullRequest({ title: 'Old' })]));

    test.refresh('visible');
    assert.equal(root().getAttribute('aria-busy'), 'true');
    assert.deepEqual(titles(), ['Old']);
    assert.equal(target.querySelector('.ghx-state--loading'), null);
    test.refresh('manual');

    const options = data.callsTo('searchPullRequests').map((args) => args[1]);
    assert.deepEqual(options.slice(1), [
      { limit: 10, forceRefresh: false },
      { limit: 10, forceRefresh: true },
    ]);
  });

  it('ignores late responses', async () => {
    mount();
    test.refresh('manual');
    await answer(1, dataResult([pullRequest({ title: 'New' })]));
    await answer(0, dataResult([pullRequest({ title: 'Late' })]));

    assert.deepEqual(titles(), ['New']);
  });

  it('ignores responses after dispose and unsubscribes', async () => {
    const dispose = mount();
    assert.equal(test.listenerCount(), 1);
    dispose();
    assert.equal(test.listenerCount(), 0);
    assert.equal(target.querySelector('.ghx-dependabot-prs'), null);
    await answer(0, dataResult([pullRequest()]));
    assert.equal(target.childElementCount, 0);
  });

  it('ignores responses after the signal was aborted', async () => {
    mount();
    test.controller.abort();
    await answer(0, dataResult([pullRequest()]));

    assert.ok(target.querySelector('.ghx-state--loading'));
  });

  describe('without repositories', () => {
    it('shows the repo picker, saves the choice and loads', async () => {
      mount({ repos: [] });
      await flush();

      assert.equal(data.callsTo('searchPullRequests').length, 0);
      assert.match(
        target.querySelector('.ghx-dependabot-prs__intro')?.textContent ?? '',
        /Choose the repositories/,
      );
      const show = buttonByText(target, 'Show pull requests');
      assert.equal(show.disabled, true);

      test.refresh('manual');
      assert.equal(data.callsTo('searchPullRequests').length, 0);

      const clickOption = (index: number): void => {
        const options = target.querySelectorAll<HTMLButtonElement>(
          '.ghx-dependabot-picker__option',
        );
        options[index]?.click();
      };
      clickOption(0);
      assert.equal(show.disabled, false);
      clickOption(0);
      assert.equal(show.disabled, true);
      clickOption(0);
      clickOption(1);
      show.click();

      assert.equal(test.saved.length, 1);
      assert.equal(test.saved[0]?.repos.length, 2);
      assert.equal(target.querySelector('.ghx-dependabot-picker'), null);
      assert.ok(target.querySelector('.ghx-state--loading'));
      assert.deepEqual(data.callsTo('searchPullRequests'), [
        [dependabotQuery(test.saved[0]?.repos ?? []), { limit: 10, forceRefresh: false }],
      ]);
      await answer(0, dataResult([pullRequest()]));
      assert.equal(titles().length, 1);
      assert.equal(target.querySelector('.ghx-dependabot-prs__status')?.childElementCount, 0);

      test.refresh('interval');
      assert.equal(pending.length, 2);
    });

    it('warns when saving the repositories fails', async () => {
      test.failSaving();
      mount({ repos: [] });
      await flush();

      target.querySelector<HTMLButtonElement>('.ghx-dependabot-picker__option')?.click();
      buttonByText(target, 'Show pull requests').click();
      await flush();

      assert.match(
        target.querySelector('.ghx-dependabot-prs__status .ghx-notice')?.textContent ?? '',
        /could not be saved/,
      );
    });

    it('does not warn about a failed save after dispose', async () => {
      test.failSaving();
      const dispose = mount({ repos: [] });
      await flush();

      target.querySelector<HTMLButtonElement>('.ghx-dependabot-picker__option')?.click();
      const status = target.querySelector('.ghx-dependabot-prs__status');
      buttonByText(target, 'Show pull requests').click();
      dispose();
      await flush();

      assert.equal(status?.childElementCount, 0);
    });

    it('filters the repositories in the picker', async () => {
      mount({ repos: [] });
      await flush();

      const input = target.querySelector<HTMLInputElement>('.ghx-dependabot-picker input');
      assert.ok(input);
      typeInto(input, 'web');
      assert.deepEqual(
        [...target.querySelectorAll('.ghx-dependabot-picker__name')].map((e) => e.textContent),
        ['acme/web'],
      );
    });

    it('offers the settings from the picker', async () => {
      data.handle('repoIndex', async () => dataResult([]));
      mount({ repos: [] });
      await flush();

      buttonByText(target, 'Open settings').click();
      assert.equal(test.openOptionsCalls(), 1);
    });
  });
});
