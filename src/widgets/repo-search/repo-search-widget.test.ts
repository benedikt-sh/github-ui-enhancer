import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult, FIXED_TIME } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RepoSummary } from '../../shared/types.ts';
import type { Dispose, RefreshReason, WidgetContext } from '../../shared/widget.ts';
import type { RepoSearchConfig } from './repo-search-config.ts';
import { repo } from './repo-search.fixture.ts';
import { createRepoSearchWidget, repoSearchWidget } from './repo-search-widget.ts';

const NOW = Date.parse(FIXED_TIME) + 5 * 60_000;
const DAY = 86_400_000;

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

/** Twelve repos, `acme/repo-0` pushed most recently. */
function manyRepos(): RepoSummary[] {
  return Array.from({ length: 12 }, (_, i) =>
    repo(`${i % 2 === 0 ? 'acme' : 'globex'}/repo-${i}`, {
      pushedAt: new Date(NOW - (i + 1) * DAY).toISOString(),
    }),
  );
}

const SMALL_INDEX = [
  repo('acme/billing-api', { description: 'Handles invoices', pushedAt: FIXED_TIME }),
  repo('acme/web', { pushedAt: '2026-11-20T12:00:00.000Z' }),
  repo('globex/billing-ui', { pushedAt: '2026-11-10T12:00:00.000Z' }),
  repo('acme/old-billing', { archived: true, pushedAt: '2026-01-01T12:00:00.000Z' }),
];

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Harness {
  readonly target: HTMLElement;
  readonly data: FakeWidgetData;
  readonly saved: RepoSearchConfig[];
  readonly opened: [url: string, newTab: boolean][];
  readonly controller: AbortController;
  readonly listenerCount: () => number;
  readonly optionsOpened: () => number;
  readonly dispose: Dispose;
  refresh(reason: RefreshReason): void;
  input(): HTMLInputElement;
  ownerSelect(): HTMLSelectElement;
  archivedCheckbox(): HTMLInputElement;
  optionNames(): string[];
  activeName(): string | undefined;
  type(value: string): void;
  key(key: string, init?: KeyboardEventInit): KeyboardEvent;
  text(selector: string): string | undefined;
  clickButton(label: string): void;
}

interface MountOptions {
  readonly data?: FakeWidgetData;
  readonly config?: Partial<RepoSearchConfig>;
  readonly saveConfig?: (config: RepoSearchConfig) => Promise<void>;
}

const mounted: Harness[] = [];

afterEach(() => {
  for (const harness of mounted.splice(0)) {
    harness.dispose();
  }
  document.body.replaceChildren();
});

function mount(options: MountOptions = {}): Harness {
  const data = options.data ?? createFakeWidgetData();
  const target = document.createElement('div');
  document.body.append(target);
  const listeners = new Set<(reason: RefreshReason) => void>();
  const saved: RepoSearchConfig[] = [];
  const opened: [string, boolean][] = [];
  const controller = new AbortController();
  let optionsOpened = 0;
  const context: WidgetContext<RepoSearchConfig> = {
    instanceId: 'repo-search',
    data,
    signal: controller.signal,
    saveConfig:
      options.saveConfig ??
      (async (config) => {
        saved.push(config);
      }),
    onRefresh(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openOptions: () => {
      optionsOpened += 1;
    },
  };
  const widget = createRepoSearchWidget({
    now: () => NOW,
    openUrl: (url, newTab) => opened.push([url, newTab]),
  });
  const config = { ...widget.defaultConfig(), ...options.config };
  const dispose = widget.mount(target, context, config);

  const query = <E extends Element>(selector: string): E => {
    const element = target.querySelector<E>(selector);
    assert.ok(element, `missing ${selector}`);
    return element;
  };
  const harness: Harness = {
    target,
    data,
    saved,
    opened,
    controller,
    dispose,
    listenerCount: () => listeners.size,
    optionsOpened: () => optionsOpened,
    refresh(reason) {
      for (const listener of listeners) {
        listener(reason);
      }
    },
    input: () => query('input[type="search"]'),
    ownerSelect: () => query('select'),
    archivedCheckbox: () => query('input[type="checkbox"]'),
    optionNames: () =>
      [...target.querySelectorAll('[role="option"] .ghx-repo-search__name')].map(
        (name) => name.textContent,
      ),
    activeName: () =>
      target.querySelector('[aria-selected="true"] .ghx-repo-search__name')?.textContent,
    type(value) {
      const input = harness.input();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    key(key, init = {}) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      harness.input().dispatchEvent(event);
      return event;
    },
    text: (selector) => target.querySelector(selector)?.textContent ?? undefined,
    clickButton(label) {
      const buttons = [...target.querySelectorAll('button')];
      const match = buttons.find(
        (button) =>
          button.textContent === label || button.getAttribute('aria-label') === label,
      );
      assert.ok(match, `missing button ${label}`);
      match.click();
    },
  };
  mounted.push(harness);
  return harness;
}

function withIndex(
  repos: RepoSummary[],
  overrides: Partial<DataResult<RepoSummary[]>> = {},
): FakeWidgetData {
  return createFakeWidgetData().handle('repoIndex', async () => dataResult(repos, overrides));
}

describe('repoSearchWidget definition', () => {
  it('is an optional widget without presets and settings form', () => {
    assert.equal(repoSearchWidget.type, 'repo-search');
    assert.equal(repoSearchWidget.title, 'Repository search');
    assert.equal(repoSearchWidget.singleton, false);
    assert.deepEqual(repoSearchWidget.presets, []);
    assert.equal(repoSearchWidget.renderConfig, null);
    assert.ok(repoSearchWidget.description.length > 0);
  });

  it('parses configs with defaults', () => {
    assert.deepEqual(repoSearchWidget.defaultConfig(), { owner: null, includeArchived: false });
    assert.deepEqual(repoSearchWidget.parseConfig({ owner: 'acme', includeArchived: 1 }), {
      owner: 'acme',
      includeArchived: false,
    });
    assert.equal(
      repoSearchWidget.instanceTitle({ owner: 'acme', includeArchived: true }),
      'Repository search',
    );
  });

  it('opens new tabs through window.open by default', async () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    const target = document.createElement('div');
    const controller = new AbortController();
    const dispose = repoSearchWidget.mount(
      target,
      {
        instanceId: 'repo-search',
        data: withIndex([repo('acme/app')]),
        signal: controller.signal,
        saveConfig: async () => undefined,
        onRefresh: () => () => undefined,
        openOptions: () => undefined,
      },
      repoSearchWidget.defaultConfig(),
    );
    try {
      await flush();
      const input = target.querySelector('input[type="search"]');
      assert.ok(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));

      assert.deepEqual(opened, [['https://github.com/acme/app', '_blank', 'noopener,noreferrer']]);
    } finally {
      window.open = original;
      dispose();
    }
  });
});

describe('repo search mount', () => {
  it('renders the search input without taking focus', () => {
    const harness = mount();
    const input = harness.input();

    assert.equal(input.getAttribute('aria-label'), 'Search repositories');
    assert.equal(input.placeholder, 'Search repositories across all your organizations');
    assert.equal(input.getAttribute('role'), 'combobox');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    const list = harness.target.querySelector('[role="listbox"]');
    assert.equal(input.getAttribute('aria-controls'), list?.id);
    assert.notEqual(document.activeElement, input);
    assert.equal(input.hasAttribute('autofocus'), false);
  });

  it('shows a loading state until the index arrives', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () => pending.promise),
    });

    assert.deepEqual(harness.data.callsTo('repoIndex'), [[]]);
    assert.equal(harness.text('.ghx-state--loading'), 'Loading repositories...');
    assert.equal(
      harness.target.querySelector<HTMLElement>('.ghx-repo-search__status')?.hidden,
      true,
    );

    pending.resolve(dataResult([repo('acme/app')]));
    await flush();

    assert.equal(harness.target.querySelector('.ghx-state--loading'), null);
    assert.deepEqual(harness.optionNames(), ['acme/app']);
  });

  it('keeps a query typed while loading and applies it to the index', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () => pending.promise),
    });

    harness.type('web');
    harness.key('Enter');

    assert.deepEqual(harness.optionNames(), []);
    assert.ok(harness.target.querySelector('.ghx-state--loading'));
    assert.deepEqual(harness.opened, []);

    pending.resolve(dataResult(SMALL_INDEX));
    await flush();

    assert.deepEqual(harness.optionNames(), ['acme/web']);
  });

  it('shows the ten most recently pushed repos for an empty query', async () => {
    const harness = mount({ data: withIndex(manyRepos()) });
    await flush();

    const names = harness.optionNames();
    assert.equal(names.length, 10);
    assert.equal(names[0], 'acme/repo-0');
    assert.equal(names[9], 'globex/repo-9');
    assert.equal(harness.activeName(), 'acme/repo-0');
    const input = harness.input();
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(
      input.getAttribute('aria-activedescendant'),
      harness.target.querySelector('[role="option"]')?.id,
    );
  });

  it('shows count, index age and a reload button in the status line', async () => {
    const harness = mount({ data: withIndex(manyRepos()) });
    await flush();

    assert.equal(harness.text('.ghx-repo-search__count'), '12 repositories');
    assert.equal(harness.text('.ghx-repo-search__age'), 'Updated 5 minutes ago');
    assert.equal(harness.target.querySelector('.ghx-repo-search__stale'), null);
    const reload = harness.target.querySelector('.ghx-repo-search__reload');
    assert.equal(reload?.getAttribute('aria-label'), 'Reload repositories');
    assert.equal(reload?.hasAttribute('disabled'), false);
  });

  it('uses the singular for a single repo and marks stale data', async () => {
    const harness = mount({ data: withIndex([repo('acme/app')], { stale: true }) });
    await flush();

    assert.equal(harness.text('.ghx-repo-search__count'), '1 repository');
    assert.equal(harness.text('.ghx-repo-search__stale'), 'Outdated');
  });

  it('omits the age for an invalid fetch time', async () => {
    const harness = mount({ data: withIndex([repo('acme/app')], { fetchedAt: 'never' }) });
    await flush();

    assert.equal(harness.target.querySelector('.ghx-repo-search__age'), null);
  });

  it('filters while typing without further requests', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    harness.type('bill');

    assert.deepEqual(harness.optionNames(), ['acme/billing-api', 'globex/billing-ui']);
    const marks = [...harness.target.querySelectorAll('[role="option"] mark')];
    assert.ok(marks.some((mark) => mark.textContent === 'bill'));
    assert.equal(harness.activeName(), 'acme/billing-api');
    assert.equal(harness.data.callsTo('repoIndex').length, 1);
  });

  it('matches descriptions with highlights', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    harness.type('invoices');

    assert.deepEqual(harness.optionNames(), ['acme/billing-api']);
    assert.equal(harness.text('.ghx-repo-search__description mark'), 'invoices');
  });

  it('explains when nothing matches the query', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    harness.type('zzz');

    assert.deepEqual(harness.optionNames(), []);
    assert.equal(harness.text('.ghx-state__title'), 'No repositories match "zzz"');
    assert.equal(
      harness.text('.ghx-state__description'),
      'Try another owner or include archived repositories.',
    );
    const input = harness.input();
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(input.hasAttribute('aria-activedescendant'), false);
  });

  it('leaves out the filter hint when no filter is active', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX), config: { includeArchived: true } });
    await flush();

    harness.type('zzz');

    assert.equal(harness.target.querySelector('.ghx-state__description'), null);
  });

  it('explains when the filters hide every repo', async () => {
    const harness = mount({ data: withIndex([repo('acme/old', { archived: true })]) });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'No repositories match the filters');
  });

  it('shows an empty state for an empty index', async () => {
    const harness = mount({ data: withIndex([]) });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'No repositories found');
    assert.equal(harness.text('.ghx-repo-search__count'), '0 repositories');
  });
});

describe('repo search keyboard', () => {
  it('moves the active result with the arrow keys and wraps around', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('bill');
    const options = [...harness.target.querySelectorAll('[role="option"]')];

    const down = harness.key('ArrowDown');

    assert.equal(down.defaultPrevented, true);
    assert.equal(harness.activeName(), 'globex/billing-ui');
    assert.equal(harness.input().getAttribute('aria-activedescendant'), options[1]?.id);
    assert.equal(options[0]?.getAttribute('aria-selected'), 'false');

    harness.key('ArrowDown');
    assert.equal(harness.activeName(), 'acme/billing-api');

    harness.key('ArrowUp');
    assert.equal(harness.activeName(), 'globex/billing-ui');
  });

  it('keeps handled keys away from page level shortcuts', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push((event as KeyboardEvent).key);
    };
    document.addEventListener('keydown', listener);
    try {
      harness.key('ArrowDown');
      harness.key('s');
      harness.key('/');
    } finally {
      document.removeEventListener('keydown', listener);
    }

    assert.deepEqual(seen, ['s', '/']);
  });

  it('ignores arrow keys without results', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('zzz');

    harness.key('ArrowDown');

    assert.equal(harness.input().hasAttribute('aria-activedescendant'), false);
  });

  it('opens the active repo in the same tab on Enter', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('bill');
    harness.key('ArrowDown');

    const event = harness.key('Enter');

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(harness.opened, [['https://github.com/globex/billing-ui', false]]);
  });

  it('opens a new tab with Ctrl+Enter and Cmd+Enter', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('web');

    harness.key('Enter', { ctrlKey: true });
    harness.key('Enter', { metaKey: true });

    assert.deepEqual(harness.opened, [
      ['https://github.com/acme/web', true],
      ['https://github.com/acme/web', true],
    ]);
  });

  it('does nothing on Enter without results or while composing', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    const composing = harness.key('Enter', { isComposing: true });
    harness.type('zzz');
    harness.key('Enter');

    assert.equal(composing.defaultPrevented, false);
    assert.deepEqual(harness.opened, []);
  });

  it('clears the query on Escape and leaves Escape alone when empty', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('web');

    const clearing = harness.key('Escape');

    assert.equal(clearing.defaultPrevented, true);
    assert.equal(harness.input().value, '');
    assert.equal(harness.optionNames().length, 3);

    const passing = harness.key('Escape');
    assert.equal(passing.defaultPrevented, false);
  });
});

describe('repo search filters', () => {
  it('lists the owners of the index', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    const select = harness.ownerSelect();

    assert.equal(select.getAttribute('aria-label'), 'Filter by owner');
    assert.deepEqual(
      [...select.options].map((option) => [option.value, option.textContent]),
      [
        ['', 'All owners'],
        ['acme', 'acme'],
        ['globex', 'globex'],
      ],
    );
    assert.equal(select.value, '');
  });

  it('filters by owner and persists the choice', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    const select = harness.ownerSelect();

    select.value = 'globex';
    select.dispatchEvent(new Event('change'));

    assert.deepEqual(harness.optionNames(), ['globex/billing-ui']);
    assert.deepEqual(harness.saved, [{ owner: 'globex', includeArchived: false }]);

    select.value = '';
    select.dispatchEvent(new Event('change'));

    assert.equal(harness.optionNames().length, 3);
    assert.deepEqual(harness.saved.at(-1), { owner: null, includeArchived: false });
  });

  it('keeps a stored owner that is not in the index', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX), config: { owner: 'gone' } });

    assert.equal(harness.ownerSelect().value, 'gone');
    await flush();

    assert.equal(harness.ownerSelect().value, 'gone');
    assert.deepEqual(harness.optionNames(), []);
    assert.equal(harness.text('.ghx-state__title'), 'No repositories match the filters');
  });

  it('includes archived repos when asked and persists the choice', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    const checkbox = harness.archivedCheckbox();
    assert.equal(checkbox.checked, false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    assert.ok(harness.optionNames().includes('acme/old-billing'));
    assert.equal(harness.text('.ghx-repo-search__badge--archived'), 'Archived');
    assert.deepEqual(harness.saved, [{ owner: null, includeArchived: true }]);
  });

  it('starts with the stored archived setting', () => {
    const harness = mount({ config: { includeArchived: true } });

    assert.equal(harness.archivedCheckbox().checked, true);
  });

  it('keeps working when saving the config fails', async () => {
    const harness = mount({
      data: withIndex(SMALL_INDEX),
      saveConfig: () => Promise.reject(new Error('quota')),
    });
    await flush();

    harness.archivedCheckbox().checked = true;
    harness.archivedCheckbox().dispatchEvent(new Event('change'));
    await flush();

    assert.ok(harness.optionNames().includes('acme/old-billing'));
  });
});

describe('repo search refresh', () => {
  it('reloads with forceRefresh from the reload button', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    harness.clickButton('Reload repositories');

    const reload = harness.target.querySelector('.ghx-repo-search__reload');
    assert.equal(reload?.hasAttribute('disabled'), true);
    assert.ok(reload?.classList.contains('ghx-repo-search__reload--busy'));
    await flush();

    assert.deepEqual(harness.data.callsTo('repoIndex'), [[], [{ forceRefresh: true }]]);
    assert.equal(
      harness.target.querySelector('.ghx-repo-search__reload')?.hasAttribute('disabled'),
      false,
    );
  });

  it('forces only manual refreshes', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();

    harness.refresh('interval');
    harness.refresh('visible');
    harness.refresh('manual');
    await flush();

    assert.deepEqual(harness.data.callsTo('repoIndex'), [[], [], [], [{ forceRefresh: true }]]);
  });

  it('keeps query and active repo when the index refreshes', async () => {
    let repos = SMALL_INDEX;
    const data = createFakeWidgetData().handle('repoIndex', async () => dataResult(repos));
    const harness = mount({ data });
    await flush();
    harness.type('bill');
    harness.key('ArrowDown');

    repos = [repo('acme/billing-new', { pushedAt: FIXED_TIME }), ...SMALL_INDEX];
    harness.refresh('interval');
    await flush();

    assert.equal(harness.input().value, 'bill');
    assert.equal(harness.optionNames().length, 3);
    assert.equal(harness.activeName(), 'globex/billing-ui');
  });

  it('falls back to the first result when the active repo disappears', async () => {
    let repos = SMALL_INDEX;
    const data = createFakeWidgetData().handle('repoIndex', async () => dataResult(repos));
    const harness = mount({ data });
    await flush();
    harness.type('bill');
    harness.key('ArrowDown');

    repos = SMALL_INDEX.filter((summary) => summary.owner !== 'globex');
    harness.refresh('interval');
    await flush();

    assert.equal(harness.activeName(), 'acme/billing-api');
  });

  it('keeps the results when the same index comes back', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    const index = [...SMALL_INDEX];
    harness.data.handle('repoIndex', async () => dataResult(index));
    harness.refresh('interval');
    await flush();
    harness.refresh('interval');
    await flush();

    assert.equal(harness.optionNames().length, 3);
  });

  it('ignores responses that were overtaken by a newer request', async () => {
    const first = deferred<DataResult<RepoSummary[]>>();
    const second = deferred<DataResult<RepoSummary[]>>();
    const queue = [first, second];
    const data = createFakeWidgetData().handle('repoIndex', () => {
      const next = queue.shift();
      assert.ok(next);
      return next.promise;
    });
    const harness = mount({ data });
    harness.refresh('manual');

    second.resolve(dataResult([repo('acme/new')]));
    await flush();
    first.resolve(dataResult([repo('acme/old')]));
    await flush();

    assert.deepEqual(harness.optionNames(), ['acme/new']);
  });

  it('ignores failures that were overtaken by a newer request', async () => {
    const first = deferred<DataResult<RepoSummary[]>>();
    const queue = [first.promise, Promise.resolve(dataResult([repo('acme/new')]))];
    const data = createFakeWidgetData().handle('repoIndex', () => {
      const next = queue.shift();
      assert.ok(next);
      return next;
    });
    const harness = mount({ data });
    harness.refresh('manual');
    await flush();
    first.reject(new Error('late'));
    await flush();

    assert.equal(harness.target.querySelector('.ghx-state--error'), null);
    assert.deepEqual(harness.optionNames(), ['acme/new']);
  });
});

describe('repo search errors', () => {
  it('shows partial errors compactly next to the results', async () => {
    const harness = mount({
      data: withIndex(SMALL_INDEX, {
        errors: [{ kind: 'unauthorized', message: 'Bad credentials', owner: 'globex' }],
      }),
    });
    await flush();

    const notice = harness.target.querySelector('.ghx-repo-search__notices .ghx-state--error');
    assert.equal(
      notice?.querySelector('.ghx-state__title')?.textContent,
      'Some repositories could not be loaded',
    );
    assert.equal(harness.optionNames().length, 3);

    harness.clickButton('Open settings');
    assert.equal(harness.optionsOpened(), 1);
  });

  it('explains missing tokens and offers the settings', async () => {
    const harness = mount({
      data: withIndex([], { errors: [{ kind: 'no_tokens', message: 'No tokens' }] }),
    });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'No access token configured');
    assert.equal(harness.target.querySelector('.ghx-repo-search__notices > *'), null);
    harness.clickButton('Open settings');
    assert.equal(harness.optionsOpened(), 1);
  });

  it('explains missing tokens from a rejected request', async () => {
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () =>
        Promise.reject(new ApiError({ kind: 'no_tokens', message: 'No tokens' })),
      ),
    });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'No access token configured');
  });

  it('shows the errors when no repo could be loaded at all', async () => {
    const harness = mount({
      data: withIndex([], { errors: [{ kind: 'network', message: 'offline' }] }),
    });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'Could not load repositories');
    harness.clickButton('Retry');
    await flush();

    assert.deepEqual(harness.data.callsTo('repoIndex'), [[], [{ forceRefresh: true }]]);
  });

  it('shows an error state with retry when the request fails', async () => {
    let fail = true;
    const data = createFakeWidgetData().handle('repoIndex', async () => {
      if (fail) {
        throw new ApiError({ kind: 'rate_limited', message: 'slow down', retryAfter: 60 });
      }
      return dataResult(SMALL_INDEX);
    });
    const harness = mount({ data });
    await flush();

    assert.equal(
      harness.text('.ghx-state--error .ghx-state__title'),
      'Could not load repositories',
    );
    assert.ok(harness.text('.ghx-error__text')?.includes('rate limit'));

    fail = false;
    harness.clickButton('Retry');
    await flush();

    assert.equal(harness.target.querySelector('.ghx-state--error'), null);
    assert.equal(harness.optionNames().length, 3);
    assert.deepEqual(harness.data.callsTo('repoIndex').at(-1), [{ forceRefresh: true }]);
  });

  it('offers the settings when a token error fails the request', async () => {
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () =>
        Promise.reject(new ApiError({ kind: 'unauthorized', message: 'Bad credentials' })),
      ),
    });
    await flush();

    harness.clickButton('Open settings');

    assert.equal(harness.optionsOpened(), 1);
  });

  it('treats a synchronous throw like a failed request', async () => {
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () => {
        throw new Error('port closed');
      }),
    });
    await flush();

    assert.equal(harness.text('.ghx-state__title'), 'Could not load repositories');
  });

  it('keeps the results when a background refresh fails', async () => {
    const harness = mount({ data: withIndex(SMALL_INDEX) });
    await flush();
    harness.type('web');
    harness.data.handle('repoIndex', () =>
      Promise.reject(new ApiError({ kind: 'network', message: 'offline' })),
    );

    harness.refresh('interval');
    await flush();

    assert.deepEqual(harness.optionNames(), ['acme/web']);
    const notice = harness.target.querySelector('.ghx-repo-search__notices .ghx-state--error');
    assert.equal(
      notice?.querySelector('.ghx-state__title')?.textContent,
      'Could not refresh repositories',
    );

    harness.data.handle('repoIndex', async () => dataResult(SMALL_INDEX));
    harness.clickButton('Retry');
    await flush();

    assert.equal(harness.target.querySelector('.ghx-repo-search__notices > *'), null);
    assert.equal(harness.input().value, 'web');
  });
});

describe('repo search dispose', () => {
  it('removes the widget and stops listening for refreshes', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () => pending.promise),
    });
    assert.equal(harness.listenerCount(), 1);

    harness.dispose();
    harness.dispose();

    assert.equal(harness.listenerCount(), 0);
    assert.equal(harness.target.childElementCount, 0);
    pending.resolve(dataResult([repo('acme/app')]));
    await flush();
    assert.equal(harness.target.childElementCount, 0);
  });

  it('ignores responses after the signal was aborted', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const harness = mount({
      data: createFakeWidgetData().handle('repoIndex', () => pending.promise),
    });

    harness.controller.abort();
    pending.resolve(dataResult([repo('acme/app')]));
    await flush();

    assert.ok(harness.target.querySelector('.ghx-state--loading'));
  });
});
