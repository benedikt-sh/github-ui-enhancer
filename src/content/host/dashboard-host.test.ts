import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeStorageArea } from '../../../test/fakes/storage.ts';
import type { FakeStorageArea } from '../../../test/fakes/storage.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DashboardLayout, WidgetInstance } from '../../shared/layout.ts';
import { createAreaStore } from '../../shared/storage.ts';
import type { KeyValueStore } from '../../shared/storage.ts';
import type { TokenInfo } from '../../shared/tokens.ts';
import { h } from '../../ui/dom.ts';
import { createDashboardHost, SINGLETON_CONFIG_KEY } from './dashboard-host.ts';
import type { DashboardHost, DashboardHostOptions, HostView } from './dashboard-host.ts';
import { DRAGGING_CLASS, DROP_AFTER_CLASS } from './drag-reorder.ts';
import { createFakeTime, createFakeVisibility, createFakeWidget } from './host.fixture.ts';
import type { FakeTime, FakeVisibility, FakeWidget } from './host.fixture.ts';

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-26T12:00:00.000Z');

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

afterEach(() => {
  document.body.replaceChildren();
});

after(async () => {
  await dom.cleanup();
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const validToken: TokenInfo = {
  id: 't1',
  owner: 'acme',
  ownerSource: 'detected',
  status: 'valid',
  login: 'octocat',
  expiresAt: null,
  lastCheckedAt: null,
  hint: 'abcd',
};

function instance(id: string, overrides: Partial<WidgetInstance> = {}): WidgetInstance {
  return { id, type: 'fake-list', width: 'half', config: { name: id }, ...overrides };
}

function layoutOf(...instances: WidgetInstance[]): DashboardLayout {
  return { version: 1, instances };
}

interface Widgets {
  readonly list: FakeWidget;
  readonly runs: FakeWidget;
  readonly search: FakeWidget;
}

function createWidgets(): Widgets {
  return {
    list: createFakeWidget({
      configurable: true,
      presets: [{ id: 'mine', title: 'Mine', config: { name: 'preset' } }],
    }),
    runs: createFakeWidget({ type: 'fake-runs', title: 'Fake runs' }),
    search: createFakeWidget({ type: 'fake-search', title: 'Fake search', singleton: true }),
  };
}

interface Setup {
  readonly host: DashboardHost;
  readonly root: HTMLElement;
  readonly widgets: Widgets;
  readonly area: FakeStorageArea;
  readonly time: FakeTime;
  readonly visibility: FakeVisibility;
  readonly views: HostView[];
  readonly errors: unknown[];
  readonly opened: number[];
  readonly tokenCalls: number[];
}

interface SetupOptions {
  readonly stored?: Record<string, unknown>;
  readonly widgets?: Widgets;
  readonly store?: (inner: KeyValueStore) => KeyValueStore;
  readonly options?: Partial<DashboardHostOptions>;
  readonly ready?: boolean;
}

async function setup(setupOptions: SetupOptions = {}): Promise<Setup> {
  const widgets = setupOptions.widgets ?? createWidgets();
  const area = createFakeStorageArea(
    setupOptions.stored ?? { 'ghx:layout': layoutOf(instance('a'), instance('b')) },
  );
  const inner = createAreaStore(area);
  const time = createFakeTime(NOW);
  const visibility = createFakeVisibility();
  const views: HostView[] = [];
  const errors: unknown[] = [];
  const opened: number[] = [];
  const tokenCalls: number[] = [];
  let nextId = 0;
  const root = h('div', { id: 'ghx-root' });
  document.body.append(root);
  const host = createDashboardHost({
    root,
    widgets: [widgets.search, widgets.list, widgets.runs],
    data: createFakeWidgetData(),
    layoutStore: setupOptions.store ? setupOptions.store(inner) : inner,
    defaultLayout: () => layoutOf(instance('default', { type: 'fake-runs' })),
    loadTokens: async () => {
      tokenCalls.push(1);
      return [validToken];
    },
    pageLogin: 'octocat',
    openOptions: () => opened.push(1),
    onViewChange: (view) => views.push(view),
    timers: time,
    visibility,
    clock: time.clock,
    createId: () => `new-${++nextId}`,
    reportError: (error) => errors.push(error),
    ...setupOptions.options,
  });
  if (setupOptions.ready !== false) {
    await host.ready;
    await flush();
  }
  return { host, root, widgets, area, time, visibility, views, errors, opened, tokenCalls };
}

const itemIds = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.ghx-host-grid > .ghx-host-item')].map(
    (item) => item.dataset['instanceId'] ?? '',
  );

const storedLayout = (area: FakeStorageArea): unknown => area.snapshot()['ghx:layout'];

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute('aria-label') === label,
  );
  assert.ok(match, `button "${label}" not found`);
  return match;
}

function itemElement(root: HTMLElement, id: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-instance-id="${id}"]`);
  assert.ok(element, `item ${id} not found`);
  return element;
}

function clickMenuItem(container: ParentNode, label: string): void {
  findButton(container, label).click();
}

describe('createDashboardHost rendering', () => {
  it('renders toolbar, singletons and the stored layout', async () => {
    const { root, widgets } = await setup({
      stored: {
        'ghx:layout': layoutOf(
          instance('a', { width: 'full' }),
          instance('b', { type: 'fake-runs' }),
        ),
      },
    });
    const host = root.querySelector<HTMLElement>('.ghx-host');
    assert.equal(host?.dataset['view'], 'dashboard');
    assert.equal(root.querySelector('.ghx-host-toolbar__title')?.textContent, 'Dashboard');
    assert.deepEqual(itemIds(root), ['a', 'b']);
    assert.ok(itemElement(root, 'a').classList.contains('ghx-host-item--full'));
    assert.equal(root.querySelector('.ghx-state--loading'), null);

    const singleton = root.querySelector('.ghx-host-singletons > .ghx-host-singleton');
    assert.ok(singleton);
    assert.equal(singleton.querySelector('.ghx-widget__actions')?.children.length, 0);
    assert.deepEqual(widgets.search.active()?.config, { name: 'default' });
    assert.equal(widgets.search.active()?.context.instanceId, 'fake-search');
    assert.deepEqual(widgets.list.active()?.config, { name: 'a' });
    assert.equal(widgets.runs.mounts.length, 1);
  });

  it('shows a loading state until the layout is loaded', async () => {
    let release: (value: unknown) => void = () => undefined;
    const { root, host } = await setup({
      ready: false,
      store: (inner) => ({
        ...inner,
        get: (key) =>
          key === 'layout' ? new Promise((resolve) => (release = resolve)) : inner.get(key),
      }),
    });
    assert.ok(root.querySelector('.ghx-host-grid .ghx-state--loading'));
    const trigger = findButton(root, 'Add widget');
    assert.equal(trigger.disabled, true);
    clickMenuItem(root, 'Fake list');
    release(layoutOf(instance('a')));
    await host.ready;
    assert.deepEqual(itemIds(root), ['a']);
    assert.equal(trigger.disabled, false);
  });

  it('uses and stores the default layout when none is stored', async () => {
    const { root, area } = await setup({ stored: {} });
    assert.deepEqual(itemIds(root), ['default']);
    assert.deepEqual(storedLayout(area), layoutOf(instance('default', { type: 'fake-runs' })));
  });

  it('replaces an invalid layout with the default', async () => {
    const { area } = await setup({ stored: { 'ghx:layout': { version: 99 } } });
    assert.deepEqual(storedLayout(area), layoutOf(instance('default', { type: 'fake-runs' })));
  });

  it('keeps the stored layout when it cannot be read', async () => {
    const failure = new Error('read');
    const { root, area, errors } = await setup({
      store: (inner) => ({
        ...inner,
        get: (key) => (key === 'layout' ? Promise.reject(failure) : inner.get(key)),
      }),
    });
    assert.deepEqual(itemIds(root), ['default']);
    assert.deepEqual(storedLayout(area), layoutOf(instance('a'), instance('b')));
    assert.ok(errors.includes(failure));
  });

  it('shows an empty state for an empty layout', async () => {
    const { root } = await setup({ stored: { 'ghx:layout': layoutOf() } });
    assert.match(root.querySelector('.ghx-host-grid')?.textContent ?? '', /dashboard is empty/);
    clickMenuItem(root, 'Fake runs');
    assert.deepEqual(itemIds(root), ['new-1']);
    assert.doesNotMatch(root.querySelector('.ghx-host-grid')?.textContent ?? '', /empty/);
  });

  it('renders a placeholder for unknown types that can be removed', async () => {
    const { root, area } = await setup({
      stored: { 'ghx:layout': layoutOf(instance('x', { type: 'future' }), instance('a')) },
    });
    assert.match(itemElement(root, 'x').textContent ?? '', /Unknown widget/);
    findButton(itemElement(root, 'x'), 'Remove widget').click();
    await flush();
    assert.deepEqual(itemIds(root), ['a']);
    assert.deepEqual(storedLayout(area), layoutOf(instance('a')));
  });

  it('keeps other widgets working when one fails to mount', async () => {
    const widgets = createWidgets();
    const broken = createFakeWidget({ mountError: () => new Error('boom') });
    const { root, errors } = await setup({
      widgets: { ...widgets, list: broken },
      stored: { 'ghx:layout': layoutOf(instance('a'), instance('b', { type: 'fake-runs' })) },
    });
    assert.ok(itemElement(root, 'a').querySelector('.ghx-state--error'));
    assert.equal(widgets.runs.mounts.length, 1);
    assert.equal(errors.length, 1);
  });

  it('accepts a custom title and initial view', async () => {
    const { root, host } = await setup({ options: { title: 'Home', initialView: 'original' } });
    assert.equal(root.querySelector('.ghx-host-toolbar__title')?.textContent, 'Home');
    assert.equal(host.view, 'original');
  });
});

describe('createDashboardHost add widget menu', () => {
  it('lists every non-singleton definition with presets', async () => {
    const { root } = await setup();
    const labels = [...root.querySelectorAll('.ghx-host-toolbar [role="menuitem"]')].map(
      (item) => item.textContent,
    );
    assert.deepEqual(labels, ['Fake list', 'Fake list: Mine', 'Fake runs']);
    assert.equal(root.querySelectorAll('.ghx-host-toolbar [role="separator"]').length, 1);
  });

  it('shows a disabled entry without addable widgets', async () => {
    const widgets = createWidgets();
    const root = h('div');
    document.body.append(root);
    const host = createDashboardHost({
      root,
      widgets: [widgets.search],
      data: createFakeWidgetData(),
      layoutStore: createAreaStore(createFakeStorageArea()),
      defaultLayout: () => layoutOf(),
      loadTokens: async () => [],
      pageLogin: null,
      openOptions: () => undefined,
      onViewChange: () => undefined,
      timers: createFakeTime(),
      visibility: createFakeVisibility(),
    });
    await host.ready;
    assert.equal(findButton(root, 'No widgets available').disabled, true);
    host.dispose();
  });

  it('opens the config form when adding a configurable widget', async () => {
    const { root, widgets, area } = await setup();
    clickMenuItem(root, 'Fake list');
    await flush();
    assert.deepEqual(itemIds(root), ['a', 'b', 'new-1']);
    assert.equal(widgets.list.forms.length, 1);
    assert.deepEqual(widgets.list.forms[0]?.context.config, { name: 'default' });
    widgets.list.forms[0]?.context.submit({ name: 'chosen' });
    await flush();
    assert.deepEqual(storedLayout(area), layoutOf(instance('a'), instance('b'), {
      id: 'new-1',
      type: 'fake-list',
      width: 'half',
      config: { name: 'chosen' },
    }));
  });

  it('mounts presets and widgets without a form right away', async () => {
    const { root, widgets } = await setup({ stored: { 'ghx:layout': layoutOf() } });
    clickMenuItem(root, 'Fake list: Mine');
    clickMenuItem(root, 'Fake runs');
    assert.deepEqual(itemIds(root), ['new-1', 'new-2']);
    assert.equal(widgets.list.forms.length, 0);
    assert.deepEqual(widgets.list.active()?.config, { name: 'preset' });
    assert.equal(widgets.runs.mounts.length, 1);
  });
});

describe('createDashboardHost instance actions', () => {
  it('moves instances without remounting and keeps the focus', async () => {
    const { root, area, widgets } = await setup({
      stored: { 'ghx:layout': layoutOf(instance('a'), instance('b'), instance('c')) },
    });
    const trigger = itemElement(root, 'c').querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    trigger?.click();
    clickMenuItem(itemElement(root, 'c'), 'Move up');
    await flush();
    assert.deepEqual(itemIds(root), ['a', 'c', 'b']);
    assert.equal(document.activeElement, trigger);
    clickMenuItem(itemElement(root, 'a'), 'Move down');
    await flush();
    assert.deepEqual(itemIds(root), ['c', 'a', 'b']);
    assert.equal(widgets.list.mounts.length, 3);
    assert.deepEqual(
      (storedLayout(area) as DashboardLayout).instances.map((entry) => entry.id),
      ['c', 'a', 'b'],
    );
    assert.equal(findButton(itemElement(root, 'c'), 'Move up').disabled, true);
    assert.equal(findButton(itemElement(root, 'b'), 'Move down').disabled, true);
  });

  it('ignores moves beyond the ends', async () => {
    const { root, area } = await setup();
    const before = area.snapshot();
    const up = findButton(itemElement(root, 'a'), 'Move up');
    up.disabled = false;
    up.click();
    await flush();
    assert.deepEqual(area.snapshot(), before);
  });

  it('toggles the width', async () => {
    const { root, area } = await setup();
    clickMenuItem(itemElement(root, 'a'), 'Use full width');
    await flush();
    assert.ok(itemElement(root, 'a').classList.contains('ghx-host-item--full'));
    assert.equal((storedLayout(area) as DashboardLayout).instances[0]?.width, 'full');
  });

  it('removes and disposes an instance', async () => {
    const { root, area, widgets } = await setup();
    const record = widgets.list.mounts[0];
    clickMenuItem(itemElement(root, 'a'), 'Remove');
    await flush();
    assert.deepEqual(itemIds(root), ['b']);
    assert.equal(record?.disposed, true);
    assert.deepEqual(storedLayout(area), layoutOf(instance('b')));
  });

  it('stores configs saved by widgets without remounting', async () => {
    const { root, area, widgets } = await setup();
    await widgets.list.mounts[1]?.context.saveConfig({ name: 'saved' });
    assert.deepEqual((storedLayout(area) as DashboardLayout).instances[1]?.config, {
      name: 'saved',
    });
    assert.equal(widgets.list.mounts.length, 2);
    assert.match(itemElement(root, 'b').textContent ?? '', /Fake list: saved/);
  });

  it('configures an instance and remounts it with the new config', async () => {
    const { root, area, widgets } = await setup();
    clickMenuItem(itemElement(root, 'a'), 'Configure');
    widgets.list.forms[0]?.context.submit({ name: 'configured' });
    await flush();
    assert.deepEqual(widgets.list.active()?.config, { name: 'configured' });
    assert.deepEqual((storedLayout(area) as DashboardLayout).instances[0]?.config, {
      name: 'configured',
    });
  });

  it('shows a notice when saving fails and clears it after the next save', async () => {
    const failure = new Error('quota');
    const { root, area, errors } = await setup();
    area.failWith(failure);
    clickMenuItem(itemElement(root, 'a'), 'Use full width');
    await flush();
    assert.match(root.querySelector('.ghx-host-save')?.textContent ?? '', /could not be saved/);
    assert.ok(errors.includes(failure));
    area.failWith(null);
    clickMenuItem(itemElement(root, 'a'), 'Use half width');
    await flush();
    assert.equal(root.querySelector('.ghx-host-save')?.children.length, 0);
  });

  it('refreshes a single instance manually', async () => {
    const { root, widgets } = await setup();
    clickMenuItem(itemElement(root, 'a'), 'Refresh');
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, ['manual']);
    assert.deepEqual(widgets.list.mounts[1]?.refreshes, []);
  });
});

describe('createDashboardHost singletons', () => {
  it('mounts singletons with their stored config and saves changes', async () => {
    const { widgets, area } = await setup({
      stored: {
        'ghx:layout': layoutOf(),
        [`ghx:${SINGLETON_CONFIG_KEY}`]: { 'fake-search': { name: 'stored' }, other: 1 },
      },
    });
    assert.deepEqual(widgets.search.active()?.config, { name: 'stored' });
    await widgets.search.active()?.context.saveConfig({ name: 'changed' });
    assert.deepEqual(area.snapshot()[`ghx:${SINGLETON_CONFIG_KEY}`], {
      'fake-search': { name: 'changed' },
      other: 1,
    });
  });

  it('falls back to the default config for broken or unreadable singleton configs', async () => {
    const broken = await setup({
      stored: { 'ghx:layout': layoutOf(), [`ghx:${SINGLETON_CONFIG_KEY}`]: 'nope' },
    });
    assert.deepEqual(broken.widgets.search.active()?.config, { name: 'default' });
    broken.host.dispose();

    const failure = new Error('read');
    const unreadable = await setup({
      store: (inner) => ({
        ...inner,
        get: (key) => (key === SINGLETON_CONFIG_KEY ? Promise.reject(failure) : inner.get(key)),
      }),
    });
    assert.deepEqual(unreadable.widgets.search.active()?.config, { name: 'default' });
    assert.ok(unreadable.errors.includes(failure));
  });

  it('does not touch the singleton key without singleton widgets', async () => {
    const widgets = createWidgets();
    const keys: string[] = [];
    const root = h('div');
    document.body.append(root);
    const inner = createAreaStore(createFakeStorageArea());
    const host = createDashboardHost({
      root,
      widgets: [widgets.list],
      data: createFakeWidgetData(),
      layoutStore: {
        ...inner,
        get: (key) => {
          keys.push(key);
          return inner.get(key);
        },
      },
      defaultLayout: () => layoutOf(),
      loadTokens: async () => [],
      pageLogin: null,
      openOptions: () => undefined,
      onViewChange: () => undefined,
      timers: createFakeTime(),
      visibility: createFakeVisibility(),
    });
    await host.ready;
    assert.deepEqual(keys, ['layout']);
    host.dispose();
  });
});

describe('createDashboardHost refresh', () => {
  it('refreshes every widget on the interval while visible', async () => {
    const { time, visibility, widgets } = await setup();
    time.advance(5 * MINUTE);
    assert.deepEqual(widgets.search.active()?.refreshes, ['interval']);
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, ['interval']);
    assert.deepEqual(widgets.list.mounts[1]?.refreshes, ['interval']);
    visibility.set(false);
    time.advance(10 * MINUTE);
    visibility.set(true);
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, ['interval', 'visible']);
  });

  it('refreshes everything manually and reloads the tokens', async () => {
    const { root, widgets, tokenCalls, host } = await setup();
    findButton(root, 'Refresh all').click();
    host.refreshAll();
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, ['manual', 'manual']);
    assert.deepEqual(widgets.search.active()?.refreshes, ['manual', 'manual']);
    await flush();
    assert.equal(tokenCalls.length, 3);
  });

  it('pauses automatic refreshes in the original view', async () => {
    const { host, time, widgets } = await setup();
    host.setView('original');
    time.advance(10 * MINUTE);
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, []);
    host.setView('dashboard');
    assert.deepEqual(widgets.list.mounts[0]?.refreshes, ['visible']);
  });
});

describe('createDashboardHost views', () => {
  it('switches to the original page and back through the UI', async () => {
    const { root, views, host } = await setup();
    const bar = root.querySelector<HTMLElement>('.ghx-host-bar');
    const dashboard = root.querySelector<HTMLElement>('.ghx-host-dashboard');
    assert.equal(bar?.hidden, true);
    findButton(root, 'Add widget').click();
    findButton(root, "Show GitHub's page").click();
    assert.deepEqual(views, ['original']);
    assert.equal(host.view, 'original');
    assert.equal(bar?.hidden, false);
    assert.equal(dashboard?.hidden, true);
    assert.equal(findButton(root, 'Add widget').getAttribute('aria-expanded'), 'false');
    findButton(root, 'Back to dashboard').click();
    assert.deepEqual(views, ['original', 'dashboard']);
    assert.equal(dashboard?.hidden, false);
  });

  it('switches silently through setView', async () => {
    const { views, host } = await setup();
    host.setView('dashboard');
    host.setView('original');
    host.setView('original');
    assert.deepEqual(views, []);
    assert.equal(host.view, 'original');
  });
});

describe('createDashboardHost token notice', () => {
  async function noticeText(
    loadTokens: DashboardHostOptions['loadTokens'],
    pageLogin: string | null = 'octocat',
  ): Promise<{ text: string; setup: Setup }> {
    const result = await setup({ options: { loadTokens, pageLogin } });
    const text = result.root.querySelector('.ghx-host-tokens')?.textContent ?? '';
    return { text, setup: result };
  }

  it('shows nothing for healthy tokens', async () => {
    const { text } = await noticeText(async () => [validToken]);
    assert.equal(text, '');
  });

  it('asks to open the settings without tokens', async () => {
    const { text, setup: result } = await noticeText(async () => []);
    assert.match(text, /No access token configured/);
    findButton(result.root, 'Open settings').click();
    assert.equal(result.opened.length, 1);
  });

  it('warns about tokens of another account', async () => {
    const { text } = await noticeText(async () => [validToken], 'someone');
    assert.match(text, /belongs to octocat, not to someone/);
  });

  it('shows nothing when loading the tokens fails', async () => {
    const failure = new Error('unreachable');
    const { text, setup: result } = await noticeText(async () => {
      throw failure;
    });
    assert.equal(text, '');
    assert.ok(result.errors.includes(failure));
  });

  it('ignores outdated token responses', async () => {
    const pending: ((tokens: TokenInfo[]) => void)[] = [];
    const { host, root } = await setup({
      options: { loadTokens: () => new Promise((resolve) => pending.push(resolve)) },
    });
    host.refreshAll();
    pending[1]?.([validToken]);
    await flush();
    pending[0]?.([]);
    await flush();
    assert.equal(root.querySelector('.ghx-host-tokens')?.textContent, '');
  });

  it('clears an earlier notice when a later load fails', async () => {
    let fail = false;
    const { host, root } = await setup({
      options: {
        loadTokens: async () => {
          if (fail) {
            throw new Error('later');
          }
          return [];
        },
      },
    });
    assert.notEqual(root.querySelector('.ghx-host-tokens')?.textContent, '');
    fail = true;
    host.refreshAll();
    await flush();
    assert.equal(root.querySelector('.ghx-host-tokens')?.textContent, '');
  });
});

describe('createDashboardHost dispose', () => {
  it('disposes widgets, timers, listeners and the container', async () => {
    const { host, root, time, visibility, widgets } = await setup();
    host.dispose();
    host.dispose();
    assert.equal(root.children.length, 0);
    assert.equal(time.pending(), 0);
    assert.equal(visibility.listenerCount(), 0);
    assert.ok(widgets.list.mounts.every((record) => record.disposed));
    assert.ok(widgets.list.mounts.every((record) => record.context.signal.aborted));
    assert.equal(widgets.search.active(), undefined);
    host.setView('original');
    assert.equal(host.view, 'dashboard');
    await widgets.list.mounts[0]?.context.saveConfig({ name: 'late' });
  });

  it('ignores layout changes from detached items', async () => {
    const { host, root, area } = await setup();
    const item = itemElement(root, 'a');
    const before = area.snapshot();
    host.dispose();
    findButton(item, 'Remove').click();
    await flush();
    assert.deepEqual(area.snapshot(), before);
  });

  it('ignores loads that finish after dispose', async () => {
    const pending: ((tokens: TokenInfo[]) => void)[] = [];
    const { host, root, widgets, area } = await setup({
      ready: false,
      stored: {},
      options: { loadTokens: () => new Promise((resolve) => pending.push(resolve)) },
    });
    host.dispose();
    await host.ready;
    pending[0]?.([]);
    await flush();
    assert.equal(root.children.length, 0);
    assert.equal(widgets.search.mounts.length, 0);
    assert.equal(widgets.list.mounts.length, 0);
    assert.deepEqual(area.snapshot(), {});
  });
});

describe('createDashboardHost defaults', () => {
  it('uses the timers and visibility of the root document', async () => {
    const widgets = createWidgets();
    const root = h('div');
    document.body.append(root);
    const host = createDashboardHost({
      root,
      widgets: [widgets.list],
      data: createFakeWidgetData(),
      layoutStore: createAreaStore(createFakeStorageArea()),
      defaultLayout: () => layoutOf(),
      loadTokens: async () => {
        throw new Error('ignored by the default reporter');
      },
      pageLogin: null,
      openOptions: () => undefined,
      onViewChange: () => undefined,
      refreshIntervalMs: 1,
    });
    await host.ready;
    clickMenuItem(root, 'Fake list: Mine');
    assert.equal(root.querySelectorAll('.ghx-host-item').length, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(widgets.list.active()?.refreshes.slice(0, 1), ['interval']);
    host.dispose();
  });

  it('requires a document with a window', () => {
    const detached = document.implementation.createHTMLDocument('detached');
    assert.throws(
      () =>
        createDashboardHost({
          root: detached.createElement('div'),
          widgets: [],
          data: createFakeWidgetData(),
          layoutStore: createAreaStore(createFakeStorageArea()),
          defaultLayout: () => layoutOf(),
          loadTokens: async () => [],
          pageLogin: null,
          openOptions: () => undefined,
          onViewChange: () => undefined,
        }),
      /must belong to a document with a window/,
    );
  });
});

describe('createDashboardHost drag and drop', () => {
  function setBox(element: Element, left: number, top: number, width: number): void {
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left, top, right: left + width, bottom: top + 100, width, height: 100 }),
    });
  }

  function pointer(target: EventTarget, type: string, x: number, y: number): void {
    const buttons = type === 'pointerup' ? 0 : 1;
    const init = { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, buttons };
    target.dispatchEvent(new dom.window.PointerEvent(type, init) as unknown as Event);
  }

  /** a | b on the first row, c on the second, all half width in a 1000px grid. */
  async function dragSetup(options: SetupOptions = {}): Promise<Setup> {
    const result = await setup({
      stored: { 'ghx:layout': layoutOf(instance('a'), instance('b'), instance('c')) },
      ...options,
    });
    const grid = result.root.querySelector('.ghx-host-grid');
    assert.ok(grid);
    setBox(grid, 0, 300, 1000);
    setBox(itemElement(result.root, 'a'), 0, 300, 490);
    setBox(itemElement(result.root, 'b'), 510, 300, 490);
    setBox(itemElement(result.root, 'c'), 0, 420, 490);
    return result;
  }

  function header(root: HTMLElement, id: string): HTMLElement {
    const element = itemElement(root, id).querySelector<HTMLElement>('.ghx-host-item__handle');
    assert.ok(element);
    return element;
  }

  function drag(root: HTMLElement, id: string, x: number, y: number, release = true): void {
    const handle = header(root, id);
    pointer(handle, 'pointerdown', 20, 320);
    pointer(handle, 'pointermove', x, y);
    if (release) {
      pointer(handle, 'pointerup', x, y);
    }
  }

  const status = (root: HTMLElement): string =>
    root.querySelector('.ghx-host-status')?.textContent ?? '';

  it('reorders by dragging the header without remounting and saves the layout', async () => {
    const { root, area, widgets } = await dragSetup();
    drag(root, 'c', 300, 350, false);
    assert.ok(itemElement(root, 'c').classList.contains(DRAGGING_CLASS));
    assert.ok(itemElement(root, 'a').classList.contains(DROP_AFTER_CLASS));
    pointer(header(root, 'c'), 'pointerup', 20, 310);
    await flush();
    assert.deepEqual(itemIds(root), ['c', 'a', 'b']);
    assert.equal(widgets.list.mounts.length, 3);
    assert.deepEqual(
      (storedLayout(area) as DashboardLayout).instances.map((entry) => entry.id),
      ['c', 'a', 'b'],
    );
    assert.equal(status(root), 'Moved "Fake list: c" to position 1 of 3.');
    assert.equal(findButton(itemElement(root, 'c'), 'Move up').disabled, true);
  });

  it('saves nothing when dropped on the original position', async () => {
    const { root, area } = await dragSetup();
    const before = area.snapshot();
    drag(root, 'b', 300, 350);
    await flush();
    assert.deepEqual(itemIds(root), ['a', 'b', 'c']);
    assert.deepEqual(area.snapshot(), before);
    assert.equal(status(root), '');
  });

  it('announces moves from the instance menu', async () => {
    const { root } = await dragSetup();
    clickMenuItem(itemElement(root, 'a'), 'Move down');
    assert.equal(status(root), 'Moved "Fake list: a" to position 2 of 3.');
  });

  it('does not drag while the config form is open', async () => {
    const { root, area, widgets } = await dragSetup();
    const before = area.snapshot();
    clickMenuItem(itemElement(root, 'a'), 'Configure');
    drag(root, 'a', 900, 450);
    await flush();
    assert.deepEqual(itemIds(root), ['a', 'b', 'c']);
    assert.deepEqual(area.snapshot(), before);
    widgets.list.forms[0]?.context.cancel();
    drag(root, 'a', 900, 600);
    await flush();
    assert.deepEqual(itemIds(root), ['b', 'c', 'a']);
  });

  it('cancels a drag when switching to the original page', async () => {
    const { root, host, area } = await dragSetup();
    const before = area.snapshot();
    drag(root, 'a', 900, 450, false);
    assert.ok(itemElement(root, 'a').classList.contains(DRAGGING_CLASS));
    host.setView('original');
    assert.equal(itemElement(root, 'a').classList.contains(DRAGGING_CLASS), false);
    pointer(header(root, 'a'), 'pointerup', 900, 450);
    drag(root, 'a', 900, 450);
    await flush();
    assert.deepEqual(area.snapshot(), before);
  });

  it('ends a running drag and its auto scroll on dispose', async () => {
    const { root, host, time } = await dragSetup();
    const scrolls: number[] = [];
    const original = window.scrollBy;
    const record = (_x: number, y: number): void => {
      scrolls.push(y);
    };
    Object.defineProperty(window, 'scrollBy', { configurable: true, value: record });
    try {
      const item = itemElement(root, 'a');
      drag(root, 'a', 500, window.innerHeight - 1, false);
      assert.ok(item.classList.contains(DRAGGING_CLASS));
      host.dispose();
      assert.equal(item.classList.contains(DRAGGING_CLASS), false);
      assert.equal(time.pending(), 0);
      time.advance(MINUTE);
      assert.deepEqual(scrolls, []);
    } finally {
      Object.defineProperty(window, 'scrollBy', { configurable: true, value: original });
    }
  });
});
