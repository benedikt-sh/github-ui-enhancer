import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeStorageArea } from '../../../test/fakes/storage.ts';
import type { FakeStorageArea } from '../../../test/fakes/storage.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import { areaKey, createAreaStore, STORAGE_KEYS } from '../../shared/storage.ts';
import type { RecentRepoItem, RepoRef } from '../../shared/types.ts';
import type { Toggleable } from '../tweaks/apply-tweaks.ts';
import { createHeaderPins, RECENT_KINDS, RECENT_REFRESH_MS, SAVE_ERROR } from './header-pins.ts';
import type { HeaderPinsOptions } from './header-pins.ts';
import { flush, GLOBAL_BAR, NOW, summary } from './header-pins.fixture.ts';
import { PINS_ATTRIBUTE } from './header-pins-view.ts';
import { PINS_VERSION } from './pins-settings.ts';

const KEY = areaKey(STORAGE_KEYS.headerPins);
const repo = (owner: string, name: string): RepoRef => ({ owner, name });

function recentItem(owner: string, name: string): RecentRepoItem {
  return {
    repo: repo(owner, name),
    url: `https://github.com/${owner}/${name}`,
    lastActivityAt: '2026-11-25T00:00:00Z',
    lastActivity: 'push',
    branch: 'main',
    activityCount: 3,
  };
}

function stored(repos: RepoRef[], recent = true): Record<string, unknown> {
  return { [KEY]: { version: PINS_VERSION, repos, recent } };
}

function renderPage(login = 'octocat'): void {
  document.head.innerHTML = `<meta name="user-login" content="${login}">`;
  document.body.innerHTML = GLOBAL_BAR;
}

interface Setup {
  readonly pins: Toggleable;
  readonly area: FakeStorageArea;
  readonly data: FakeWidgetData;
  readonly listeners: Set<(value: unknown) => void>;
  readonly clock: { time: number };
}

const running: Toggleable[] = [];

function setup(
  initial: Record<string, unknown> = {},
  recent: RecentRepoItem[] = [],
  extra: Partial<HeaderPinsOptions> = {},
): Setup {
  const area = createFakeStorageArea(initial);
  const data = createFakeWidgetData()
    .handle('recentRepositories', async () => dataResult(recent))
    .handle('repoIndex', async () => dataResult([summary('octo', 'alpha')]));
  const listeners = new Set<(value: unknown) => void>();
  const clock = { time: NOW };
  const pins = createHeaderPins({
    document,
    window,
    data,
    store: createAreaStore(area),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now: () => clock.time,
    ...extra,
  });
  running.push(pins);
  return { pins, area, data, listeners, clock };
}

function roots(): Element[] {
  return [...document.querySelectorAll(`[${PINS_ATTRIBUTE}]`)];
}

function linkNames(): string[] {
  return [...document.querySelectorAll('.ghx-header-pins__link')].map((link) => {
    const kind = link.classList.contains('ghx-header-pins__link--recent') ? 'recent' : 'pinned';
    return `${kind}:${link.getAttribute('title')?.split(' ')[0]}`;
  });
}

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  assert.ok(found !== null, selector);
  return found;
}

describe('createHeaderPins', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom('https://github.com/octo/alpha');
  });
  after(() => dom.cleanup());
  beforeEach(() => {
    renderPage();
  });
  // A failed test must not leave a running instance behind, two would fight over the header.
  afterEach(() => {
    running.splice(0).forEach((pins) => pins.stop());
  });

  it('inserts the pins in front of the search and removes every trace on stop', async () => {
    const { pins, listeners } = setup(stored([repo('octo', 'alpha')]));

    pins.start();
    pins.start();
    assert.deepEqual(roots(), []);
    await flush();

    assert.equal(roots().length, 1);
    assert.equal(roots()[0]?.nextElementSibling, document.getElementById('search'));
    assert.deepEqual(linkNames(), ['pinned:octo/alpha']);
    assert.equal(listeners.size, 1);

    pins.stop();
    pins.stop();
    assert.deepEqual(roots(), []);
    assert.equal(listeners.size, 0);
  });

  it('shows the latest active repository unless it is pinned already', async () => {
    const { pins, data } = setup(stored([repo('octo', 'alpha')]), [recentItem('acme', 'gamma')]);
    pins.start();
    await flush();

    assert.deepEqual(linkNames(), ['pinned:octo/alpha', 'recent:acme/gamma']);
    assert.deepEqual(data.callsTo('recentRepositories'), [[{ kinds: RECENT_KINDS, limit: 1 }]]);
    pins.stop();

    const again = setup(stored([repo('ACME', 'Gamma')]), [recentItem('acme', 'gamma')]);
    again.pins.start();
    await flush();
    assert.deepEqual(linkNames(), ['pinned:ACME/Gamma']);
    again.pins.stop();
  });

  it('skips the automatic pin when it is switched off', async () => {
    const { pins, data } = setup(stored([], false), [recentItem('acme', 'gamma')]);
    pins.start();
    await flush();

    assert.deepEqual(linkNames(), []);
    assert.deepEqual(data.callsTo('recentRepositories'), []);
    assert.equal(roots().length, 1);
    pins.stop();
  });

  it('omits the automatic pin when the data layer fails', async () => {
    for (const handler of [
      () => Promise.reject(new Error('down')),
      () => {
        throw new Error('sync');
      },
      async () => dataResult([{ ...recentItem('bad owner', 'x') }]),
      async () => dataResult([]),
    ]) {
      const { pins, data } = setup(stored([repo('octo', 'alpha')]));
      data.handle('recentRepositories', handler);
      pins.start();
      await flush();

      assert.deepEqual(linkNames(), ['pinned:octo/alpha']);
      pins.stop();
    }
  });

  it('refreshes the automatic pin at most every few minutes on visibility changes', async () => {
    const { pins, data, clock } = setup({}, [recentItem('acme', 'gamma')]);
    pins.start();
    await flush();
    assert.equal(data.callsTo('recentRepositories').length, 1);

    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    assert.equal(data.callsTo('recentRepositories').length, 1);

    clock.time += RECENT_REFRESH_MS;
    data.handle('recentRepositories', async () => dataResult([recentItem('octo', 'delta')]));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    assert.equal(data.callsTo('recentRepositories').length, 1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    assert.equal(data.callsTo('recentRepositories').length, 2);

    assert.deepEqual(linkNames(), ['recent:octo/delta']);
    pins.stop();
    delete (document as unknown as Record<string, unknown>)['visibilityState'];
  });

  it('drops results that arrive after stop', async () => {
    let resolve: (items: RecentRepoItem[]) => void = () => {};
    const { pins, data } = setup();
    data.handle(
      'recentRepositories',
      () => new Promise((done) => (resolve = (items) => done(dataResult(items)))),
    );
    pins.start();
    await flush();
    pins.stop();

    resolve([recentItem('acme', 'gamma')]);
    await flush();
    assert.deepEqual(roots(), []);
  });

  it('waits until the page has settled before inserting', async () => {
    let settle = (): void => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { pins } = setup(stored([repo('octo', 'alpha')]), [], { settled });

    pins.start();
    await flush();
    assert.deepEqual(roots(), []);

    settle();
    await flush();
    assert.equal(roots().length, 1);
  });

  it('does not insert anything when stopped while loading', async () => {
    const { pins } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    pins.stop();
    await flush();

    assert.deepEqual(roots(), []);
  });

  it('uses the defaults when the stored pins cannot be read', async () => {
    const { pins, area, data } = setup({}, [recentItem('acme', 'gamma')]);
    area.failWith(new Error('quota'));
    pins.start();
    await flush();

    assert.deepEqual(linkNames(), ['recent:acme/gamma']);
    assert.equal(data.callsTo('recentRepositories').length, 1);
    pins.stop();
  });

  it('inserts the pins again after GitHub re-renders the header', async () => {
    const { pins, data, clock } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    await flush();
    const first = roots()[0];

    clock.time += RECENT_REFRESH_MS;
    document.body.innerHTML = GLOBAL_BAR;
    await flush();

    assert.equal(roots().length, 1);
    assert.equal(roots()[0], first);
    assert.equal(roots()[0]?.nextElementSibling, document.getElementById('search'));
    assert.equal(data.callsTo('recentRepositories').length, 2);
    pins.stop();
  });

  it('removes lifeless copies from restored page snapshots', async () => {
    const { pins } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    await flush();
    const own = roots()[0];
    assert.ok(own !== undefined);

    const snapshot = document.body.innerHTML;
    own.remove();
    document.body.innerHTML = snapshot;
    await flush();

    assert.equal(roots().length, 1);
    assert.equal(roots()[0], own);
    pins.stop();
  });

  it('waits for the header and removes the pins when no slot is left', async () => {
    document.body.innerHTML = '<main>No header</main>';
    const { pins } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    await flush();
    assert.deepEqual(roots(), []);

    document.body.innerHTML = GLOBAL_BAR;
    await flush();
    assert.equal(roots().length, 1);

    const pinsElement = roots()[0];
    assert.ok(pinsElement !== undefined);
    document.body.innerHTML = '<main>No header</main>';
    document.body.append(pinsElement);
    await flush();
    assert.deepEqual(roots(), []);
    pins.stop();
  });

  it('leaves logged-out pages alone', async () => {
    renderPage('');
    const { pins } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    await flush();
    assert.deepEqual(roots(), []);

    document.head.innerHTML = '<meta name="user-login" content="octocat">';
    document.body.innerHTML = GLOBAL_BAR;
    await flush();
    assert.deepEqual(roots(), []);
    pins.stop();
  });

  it('applies changes from other tabs live', async () => {
    const { pins, listeners } = setup(stored([repo('octo', 'alpha')]));
    pins.start();
    const notify = (value: unknown): void => listeners.forEach((listener) => listener(value));
    notify({ version: PINS_VERSION, repos: [repo('octo', 'beta')], recent: false });
    await flush();

    assert.deepEqual(linkNames(), ['pinned:octo/beta']);
    const before = element('.ghx-header-pins__list').firstElementChild;
    notify({ version: PINS_VERSION, repos: [repo('octo', 'beta')], recent: false });
    assert.equal(element('.ghx-header-pins__list').firstElementChild, before);

    notify(undefined);
    assert.deepEqual(linkNames(), []);
    pins.stop();
  });

  it('saves changes made in the panel', async () => {
    const { pins, area, listeners } = setup(stored([repo('octo', 'alpha')], false));
    pins.start();
    await flush();
    const unpin = element<HTMLButtonElement>('.ghx-header-pins__entry button');

    unpin.click();
    assert.deepEqual(linkNames(), []);
    listeners.forEach((listener) => listener(stored([repo('octo', 'alpha')], false)[KEY]));
    assert.deepEqual(linkNames(), []);
    await flush();
    assert.deepEqual(area.snapshot()[KEY], { version: PINS_VERSION, repos: [], recent: false });

    element<HTMLButtonElement>('.ghx-header-pins__add').click();
    await flush();
    element<HTMLInputElement>('.ghx-pin-picker__input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    element<HTMLInputElement>('input[type="checkbox"]').click();
    await flush();

    assert.deepEqual(area.snapshot()[KEY], {
      version: PINS_VERSION,
      repos: [repo('octo', 'alpha')],
      recent: true,
    });
    pins.stop();
  });

  it('skips saving unchanged pins and clicks on a stopped view', async () => {
    const { pins, area } = setup(stored([repo('octo', 'alpha')], false));
    pins.start();
    await flush();
    const toggle = element<HTMLInputElement>('input[type="checkbox"]');
    const unpin = element<HTMLButtonElement>('.ghx-header-pins__entry button');
    area.failWith(new Error('must not write'));

    toggle.dispatchEvent(new Event('change'));
    pins.stop();
    unpin.click();
    await flush();

    area.failWith(null);
    assert.deepEqual(area.snapshot()[KEY], stored([repo('octo', 'alpha')], false)[KEY]);
  });

  it('reverts and reports a failed save', async () => {
    const { pins, area } = setup(stored([repo('octo', 'alpha')], false));
    pins.start();
    await flush();
    area.failWith(new Error('quota'));

    element<HTMLButtonElement>('.ghx-header-pins__entry button').click();
    assert.deepEqual(linkNames(), []);
    await flush();

    assert.deepEqual(linkNames(), ['pinned:octo/alpha']);
    assert.equal(element('.ghx-header-pins__error').textContent, SAVE_ERROR);

    area.failWith(null);
    element<HTMLButtonElement>('.ghx-header-pins__entry button').click();
    assert.equal(element('.ghx-header-pins__error').hidden, true);
    await flush();
    pins.stop();
  });

  it('ignores a failed save that was overtaken or stopped', async () => {
    const { pins, area } = setup(stored([repo('octo', 'alpha'), repo('octo', 'beta')], false));
    pins.start();
    await flush();
    area.failWith(new Error('quota'));

    element<HTMLButtonElement>('.ghx-header-pins__entry button').click();
    element<HTMLButtonElement>('.ghx-header-pins__entry button').click();
    await flush();
    assert.deepEqual(linkNames(), ['pinned:octo/beta']);

    element<HTMLButtonElement>('.ghx-header-pins__entry button').click();
    pins.stop();
    await flush();
    assert.deepEqual(roots(), []);
  });
});
