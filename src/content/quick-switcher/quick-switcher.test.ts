import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RepoSummary } from '../../shared/types.ts';
import type { Toggleable } from '../tweaks/apply-tweaks.ts';
import { DIALOG_ATTRIBUTE } from './dialog.ts';
import { DOUBLE_SHIFT_INTERVAL_MS } from './double-shift.ts';
import { deferred, flush, NOW, recentItem, repo, REPOS } from './quick-switcher.fixture.ts';
import { createQuickSwitcher, defaultOpenUrl } from './quick-switcher.ts';
import type { QuickSwitcherOptions, QuickSwitcherWindow } from './quick-switcher.ts';
import { REFRESH_INTERVAL_MS } from './repo-store.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

interface FakeWindow extends QuickSwitcherWindow {
  readonly opened: [string, string, string][];
  readonly assigned: string[];
}

function fakeWindow(): FakeWindow {
  const opened: [string, string, string][] = [];
  const assigned: string[] = [];
  return {
    opened,
    assigned,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    setTimeout: window.setTimeout.bind(window),
    open(url, target, features) {
      opened.push([url, target, features]);
      return null;
    },
    location: {
      assign: (url) => {
        assigned.push(url);
      },
    },
  };
}

interface Setup {
  readonly switcher: Toggleable;
  readonly data: FakeWidgetData;
  readonly win: FakeWindow;
  readonly clock: { time: number };
}

const created: Toggleable[] = [];

function setup(overrides: Partial<QuickSwitcherOptions> = {}): Setup {
  const data = createFakeWidgetData()
    .handle('repoIndex', async () => dataResult([...REPOS]))
    .handle('recentRepositories', async () => dataResult([recentItem('acme/web')]));
  const win = fakeWindow();
  const clock = { time: NOW };
  const switcher = createQuickSwitcher({
    document,
    window: win,
    data,
    now: () => clock.time,
    ...overrides,
  });
  created.push(switcher);
  return { switcher, data, win, clock };
}

beforeEach(() => {
  document.body.innerHTML = '<textarea id="comment"></textarea><button id="other">Other</button>';
});

afterEach(() => {
  for (const switcher of created.splice(0)) {
    switcher.stop();
  }
});

function keydown(name: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function doubleShift(clock: { time: number }, target: EventTarget = document.body): void {
  keydown('Shift', { shiftKey: true }, target);
  clock.time += 100;
  keydown('Shift', { shiftKey: true }, target);
  clock.time += 100;
}

function dialogs(): Element[] {
  return [...document.querySelectorAll(`[${DIALOG_ATTRIBUTE}]`)];
}

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('.ghx-quick-switcher__input');
  assert.ok(element);
  return element;
}

function optionNames(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map(
    (option) => option.querySelector('.ghx-quick-switcher__name')?.textContent ?? '',
  );
}

function stateText(): string {
  return document.querySelector('.ghx-quick-switcher__state')?.textContent ?? '';
}

describe('createQuickSwitcher', () => {
  it('does nothing before start', () => {
    const { clock, data } = setup();
    doubleShift(clock);
    assert.deepEqual(dialogs(), []);
    assert.equal(data.calls.length, 0);
  });

  it('opens on a double Shift and loads the repositories', async () => {
    const { switcher, clock, data } = setup();
    switcher.start();
    doubleShift(clock);
    assert.equal(dialogs().length, 1);
    assert.equal(document.activeElement, input());
    assert.match(stateText(), /Loading repositories/);

    await flush();
    assert.equal(stateText(), '');
    assert.deepEqual(optionNames(), [
      'acme/web',
      'acme/billing-api',
      'globex/billing-ui',
      'octo/forked',
    ]);
    assert.equal(data.callsTo('repoIndex').length, 1);
    assert.deepEqual(data.callsTo('recentRepositories'), [
      [{ kinds: ['push', 'pull_request', 'create'], limit: 5 }],
    ]);
  });

  it('never prevents the Shift presses', () => {
    const { switcher, clock } = setup();
    switcher.start();
    const first = keydown('Shift', { shiftKey: true });
    clock.time += 50;
    const second = keydown('Shift', { shiftKey: true });
    assert.equal(first.defaultPrevented, false);
    assert.equal(second.defaultPrevented, false);
  });

  it('opens while typing in a text field and gives the focus back on Escape', async () => {
    const { switcher, clock } = setup();
    switcher.start();
    const textarea = document.getElementById('comment');
    assert.ok(textarea);
    textarea.focus();
    doubleShift(clock, textarea);
    assert.equal(document.activeElement, input());
    keydown('Escape', {}, input());
    assert.deepEqual(dialogs(), []);
    assert.equal(document.activeElement, textarea);
  });

  it('sees Shift presses even when GitHub stops their propagation', () => {
    const { switcher, clock } = setup();
    switcher.start();
    const stopper = (event: Event): void => event.stopPropagation();
    const other = document.getElementById('other');
    other?.addEventListener('keydown', stopper);
    doubleShift(clock, other ?? document.body);
    assert.equal(dialogs().length, 1);
  });

  it('does not open while typing capital letters', () => {
    const { switcher, clock } = setup();
    switcher.start();
    for (const char of 'AB') {
      keydown('Shift', { shiftKey: true });
      keydown(char, { shiftKey: true });
      clock.time += 60;
    }
    keydown('Shift', { shiftKey: true });
    assert.deepEqual(dialogs(), []);
  });

  it('does not open for a slow second press, a held Shift or an IME composition', () => {
    const { switcher, clock } = setup();
    switcher.start();
    keydown('Shift', { shiftKey: true });
    clock.time += DOUBLE_SHIFT_INTERVAL_MS + 1;
    keydown('Shift', { shiftKey: true, repeat: true });
    keydown('Shift', { shiftKey: true, isComposing: true });
    clock.time += 50;
    keydown('Shift', { shiftKey: true, ctrlKey: true });
    assert.deepEqual(dialogs(), []);
  });

  it('forgets a first press when the window loses focus or the mouse is pressed', () => {
    const { switcher, clock } = setup();
    switcher.start();
    keydown('Shift', { shiftKey: true });
    window.dispatchEvent(new Event('blur'));
    clock.time += 50;
    keydown('Shift', { shiftKey: true });
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clock.time += 50;
    keydown('Shift', { shiftKey: true });
    assert.deepEqual(dialogs(), []);
  });

  it('focuses the open dialog again instead of opening a second one', () => {
    const { switcher, clock } = setup();
    switcher.start();
    doubleShift(clock);
    input().value = 'acme';
    doubleShift(clock, input());
    assert.equal(dialogs().length, 1);
    assert.equal(document.activeElement, input());
    assert.equal(input().selectionStart, 0);
    assert.equal(input().selectionEnd, 4);
  });

  it('opens a new dialog when the page swapped the body', () => {
    const { switcher, clock } = setup();
    switcher.start();
    doubleShift(clock);
    const old = dialogs()[0];
    document.body.replaceChildren();
    doubleShift(clock);
    assert.equal(dialogs().length, 1);
    assert.notEqual(dialogs()[0], old);
  });

  it('shows cached repositories right away on later openings', async () => {
    const { switcher, clock, data } = setup();
    switcher.start();
    doubleShift(clock);
    await flush();
    keydown('Escape', {}, input());

    doubleShift(clock);
    assert.equal(optionNames().length, 4);
    assert.equal(stateText(), '');
    await flush();
    assert.equal(data.callsTo('repoIndex').length, 1);
  });

  it('refreshes in the background on a later opening and updates the open list', async () => {
    const { switcher, clock, data } = setup();
    switcher.start();
    doubleShift(clock);
    await flush();
    keydown('Escape', {}, input());

    clock.time += REFRESH_INTERVAL_MS;
    const next = deferred<DataResult<RepoSummary[]>>();
    data.handle('repoIndex', () => next.promise);
    doubleShift(clock);
    input().value = 'new';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    assert.match(stateText(), /No repositories match "new"/);

    next.resolve(dataResult([repo('acme/new-thing')], { fetchedAt: '2026-11-26T13:00:00Z' }));
    await flush();
    assert.deepEqual(optionNames(), ['acme/new-thing']);
    assert.equal(data.callsTo('repoIndex').length, 2);
  });

  it('stops updating a closed dialog', async () => {
    const { switcher, clock, data } = setup();
    const pending = deferred<DataResult<RepoSummary[]>>();
    data.handle('repoIndex', () => pending.promise);
    switcher.start();
    doubleShift(clock);
    keydown('Escape', {}, input());
    pending.resolve(dataResult([...REPOS]));
    await flush();
    assert.deepEqual(dialogs(), []);
  });

  it('searches as the user types and opens the result with Enter', async () => {
    const { switcher, clock, win } = setup();
    switcher.start();
    doubleShift(clock);
    await flush();
    input().value = 'billing';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    assert.deepEqual(optionNames(), ['acme/billing-api', 'globex/billing-ui', 'acme/old-billing']);
    keydown('ArrowDown', {}, input());
    keydown('Enter', {}, input());
    assert.deepEqual(win.assigned, ['https://github.com/globex/billing-ui']);
    assert.deepEqual(dialogs(), []);
  });

  it('opens a new tab with Ctrl+Enter', async () => {
    const { switcher, clock, win } = setup();
    switcher.start();
    doubleShift(clock);
    await flush();
    keydown('Enter', { ctrlKey: true }, input());
    assert.deepEqual(win.opened, [
      ['https://github.com/acme/web', '_blank', 'noopener,noreferrer'],
    ]);
    assert.deepEqual(win.assigned, []);
  });

  it('uses an injected openUrl', async () => {
    const opened: [string, boolean][] = [];
    const { switcher, clock } = setup({ openUrl: (url, newTab) => opened.push([url, newTab]) });
    switcher.start();
    doubleShift(clock);
    await flush();
    keydown('Enter', { metaKey: true }, input());
    assert.deepEqual(opened, [['https://github.com/acme/web', true]]);
  });

  it('retries a failed load past the cache', async () => {
    const { switcher, clock, data } = setup();
    data.handle('repoIndex', () => Promise.reject(new ApiError({ kind: 'network', message: 'x' })));
    switcher.start();
    doubleShift(clock);
    await flush();
    assert.match(stateText(), /Could not load repositories/);

    data.handle('repoIndex', async () => dataResult([...REPOS]));
    const retry = [...document.querySelectorAll<HTMLButtonElement>('.ghx-quick-switcher button')]
      .find((element) => element.textContent === 'Retry');
    retry?.focus();
    retry?.click();
    assert.match(stateText(), /Loading repositories/);
    assert.equal(document.activeElement, input());
    await flush();
    assert.equal(optionNames().length, 4);
    assert.deepEqual(data.callsTo('repoIndex').at(-1), [{ forceRefresh: true }]);
  });

  it('offers the settings when no token is configured', async () => {
    let settings = 0;
    const { switcher, clock, data } = setup({
      openOptions: () => {
        settings += 1;
      },
    });
    data.handle('repoIndex', () =>
      Promise.reject(new ApiError({ kind: 'no_tokens', message: 'none' })),
    );
    switcher.start();
    doubleShift(clock);
    await flush();
    assert.match(stateText(), /No access token configured/);
    document.querySelector<HTMLButtonElement>('.ghx-quick-switcher__state button')?.click();
    assert.equal(settings, 1);
  });

  it('removes the listeners and an open dialog on stop', () => {
    const { switcher, clock } = setup();
    switcher.start();
    doubleShift(clock);
    switcher.stop();
    assert.deepEqual(dialogs(), []);
    doubleShift(clock);
    assert.deepEqual(dialogs(), []);
  });

  it('ignores repeated starts and stops', async () => {
    const { switcher, clock, data } = setup();
    switcher.stop();
    switcher.start();
    switcher.start();
    keydown('Shift', { shiftKey: true });
    clock.time += 50;
    keydown('Shift', { shiftKey: true });
    clock.time += 50;
    keydown('Shift', { shiftKey: true });
    assert.equal(dialogs().length, 1);
    await flush();
    assert.equal(data.callsTo('repoIndex').length, 1);
    switcher.stop();
    switcher.stop();
    switcher.start();
    doubleShift(clock);
    assert.equal(dialogs().length, 1);
  });
});

describe('defaultOpenUrl', () => {
  it('navigates the current tab or opens a new one without opener', () => {
    const win = fakeWindow();
    const open = defaultOpenUrl(win);
    open('https://github.com/a/b', false);
    open('https://github.com/c/d', true);
    assert.deepEqual(win.assigned, ['https://github.com/a/b']);
    assert.deepEqual(win.opened, [['https://github.com/c/d', '_blank', 'noopener,noreferrer']]);
  });
});
