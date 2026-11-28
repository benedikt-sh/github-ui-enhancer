import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { RepoRef } from '../../shared/types.ts';
import { flush, NOW, summary } from './header-pins.fixture.ts';
import { createHeaderPinsView, PINS_ATTRIBUTE, repoUrl } from './header-pins-view.ts';
import type { HeaderPinsState, HeaderPinsView } from './header-pins-view.ts';
import { MAX_PINS } from './pins-settings.ts';

const repo = (owner: string, name: string): RepoRef => ({ owner, name });

interface Setup {
  readonly view: HeaderPinsView;
  readonly added: RepoRef[];
  readonly removed: RepoRef[];
  readonly moved: [string, number][];
  readonly recentChanges: boolean[];
}

function setup(): Setup {
  const added: RepoRef[] = [];
  const removed: RepoRef[] = [];
  const recentChanges: boolean[] = [];
  const moved: [string, number][] = [];
  const view = createHeaderPinsView({
    document,
    loadRepos: async () => [summary('octo', 'alpha'), summary('octo', 'beta')],
    onAdd: (value) => added.push(value),
    onRemove: (value) => removed.push(value),
    onMove: (value, index) => moved.push([value.name, index]),
    onRecentChange: (value) => recentChanges.push(value),
    now: () => NOW,
  });
  document.body.append(view.root);
  return { view, added, removed, moved, recentChanges };
}

function state(repos: RepoRef[], overrides: Partial<HeaderPinsState> = {}): HeaderPinsState {
  return { settings: { repos, recent: true }, recent: null, error: null, ...overrides };
}

function query<T extends Element = HTMLElement>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  assert.ok(element !== null, selector);
  return element;
}

function links(view: HeaderPinsView): string[][] {
  return [...view.root.querySelectorAll('.ghx-header-pins__link')].map((link) => [
    link.textContent,
    link.getAttribute('href') ?? '',
    link.getAttribute('title') ?? '',
    link.querySelector('svg')?.getAttribute('class')?.includes('clock') ? 'clock' : 'repo',
  ]);
}

describe('createHeaderPinsView', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds repo urls only for valid repos', () => {
    assert.equal(repoUrl(repo('octo', 'alpha')), 'https://github.com/octo/alpha');
  });

  it('renders pinned links and the automatic pin', () => {
    const { view } = setup();
    assert.equal(view.root.hasAttribute(PINS_ATTRIBUTE), true);

    view.update(state([repo('octo', 'alpha')], { recent: repo('acme', 'gamma') }));

    assert.deepEqual(links(view), [
      ['alpha', 'https://github.com/octo/alpha', 'octo/alpha', 'repo'],
      [
        'gamma',
        'https://github.com/acme/gamma',
        'acme/gamma (your most recent activity)',
        'clock',
      ],
    ]);
    assert.equal(query(view.root, 'nav').hidden, false);
    assert.equal(query(view.root, '.ghx-header-pins__count').textContent, `1 of ${MAX_PINS}`);
    assert.equal(query(view.root, '.ghx-header-pins__empty').hidden, true);
    assert.equal(query(view.root, '.ghx-header-pins__error').hidden, true);

    view.update(state([], { error: 'Broken' }));
    assert.deepEqual(links(view), []);
    assert.equal(query(view.root, 'nav').hidden, true);
    assert.equal(query(view.root, '.ghx-header-pins__entries').hidden, true);
    assert.equal(query(view.root, '.ghx-header-pins__empty').hidden, false);
    assert.equal(query(view.root, '.ghx-header-pins__error').textContent, 'Broken');
  });

  it('opens and closes the panel from the trigger and with Escape', () => {
    const { view } = setup();
    view.update(state([]));
    const trigger = query<HTMLButtonElement>(view.root, '.ghx-header-pins__trigger');
    const panel = query(view.root, '[role="dialog"]');

    trigger.click();
    assert.equal(view.isOpen(), true);
    assert.equal(panel.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, query(view.root, '.ghx-header-pins__add'));
    view.open();

    trigger.click();
    assert.equal(view.isOpen(), false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    view.close();

    view.open();
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    panel.dispatchEvent(other);
    assert.equal(view.isOpen(), true);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    panel.dispatchEvent(escape);
    assert.equal(view.isOpen(), false);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(document.activeElement, trigger);
  });

  it('closes on pointer or focus outside, not inside', () => {
    const { view } = setup();
    view.update(state([]));
    const outside = document.createElement('button');
    document.body.append(outside);

    view.open();
    query(view.root, '.ghx-header-pins__title').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    assert.equal(view.isOpen(), true);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert.equal(view.isOpen(), false);

    view.open();
    outside.focus();
    assert.equal(view.isOpen(), false);

    view.open();
    view.dispose();
    assert.equal(view.isOpen(), false);
  });

  it('lists pins in the panel and unpins them', () => {
    const { view, removed } = setup();
    view.update(state([repo('octo', 'alpha'), repo('octo', 'beta')]));
    view.open();

    const entries = view.root.querySelectorAll('.ghx-header-pins__entry');
    assert.deepEqual(
      [...entries].map((entry) => entry.querySelector('a')?.textContent),
      ['octo/alpha', 'octo/beta'],
    );
    const unpin = query<HTMLButtonElement>(entries[1] as Element, 'button[aria-label^="Unpin"]');
    assert.equal(unpin.getAttribute('aria-label'), 'Unpin octo/beta');

    unpin.click();

    assert.deepEqual(removed, [repo('octo', 'beta')]);
    assert.equal(document.activeElement, query(view.root, '.ghx-header-pins__add'));
  });

  it('adds a repository through the picker', async () => {
    const { view, added } = setup();
    view.update(state([repo('octo', 'alpha')]));
    view.open();
    const add = query<HTMLButtonElement>(view.root, '.ghx-header-pins__add');

    add.click();
    add.click();
    assert.equal(add.hidden, true);
    assert.equal(view.root.querySelectorAll('.ghx-pin-picker').length, 1);
    const input = query<HTMLInputElement>(view.root, '.ghx-pin-picker__input');
    assert.equal(document.activeElement, input);
    await flush();

    assert.deepEqual(
      [...view.root.querySelectorAll('[role="option"]')].map((option) => option.textContent),
      ['octo/beta'],
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    assert.deepEqual(added, [repo('octo', 'beta')]);
    assert.equal(view.root.querySelector('.ghx-pin-picker'), null);
    assert.equal(add.hidden, false);
    assert.equal(document.activeElement, add);
  });

  it('cancels the picker with Escape and keeps the panel open', () => {
    const { view } = setup();
    view.update(state([]));
    view.open();
    query<HTMLButtonElement>(view.root, '.ghx-header-pins__add').click();
    const input = query<HTMLInputElement>(view.root, '.ghx-pin-picker__input');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.equal(view.root.querySelector('.ghx-pin-picker'), null);
    assert.equal(view.isOpen(), true);
    assert.equal(document.activeElement, query(view.root, '.ghx-header-pins__add'));
  });

  it('closes the picker together with the panel', () => {
    const { view } = setup();
    view.update(state([]));
    view.open();
    query<HTMLButtonElement>(view.root, '.ghx-header-pins__add').click();

    view.close();
    view.open();

    assert.equal(view.root.querySelector('.ghx-pin-picker'), null);
  });

  it('disables adding at the limit and says so', () => {
    const { view } = setup();
    const full = Array.from({ length: MAX_PINS }, (_, index) => repo('octo', `r${index}`));
    view.update(state([]));
    view.open();
    const add = query<HTMLButtonElement>(view.root, '.ghx-header-pins__add');
    add.click();

    view.update(state(full));

    assert.equal(view.root.querySelector('.ghx-pin-picker'), null);
    assert.equal(add.disabled, true);
    assert.equal(query(view.root, '.ghx-header-pins__limit').hidden, false);
    add.click();
    assert.equal(view.root.querySelector('.ghx-pin-picker'), null);

    view.close();
    view.open();
    assert.equal(document.activeElement, query(view.root, '.ghx-header-pins__trigger'));

    view.update(state(full.slice(1)));
    assert.equal(add.disabled, false);
    assert.equal(query(view.root, '.ghx-header-pins__limit').hidden, true);
  });

  it('reflects and reports the recent option', () => {
    const { view, recentChanges } = setup();
    view.update(state([], { settings: { repos: [], recent: false } }));
    const toggle = query<HTMLInputElement>(view.root, 'input[type="checkbox"]');
    assert.equal(toggle.checked, false);

    toggle.click();
    assert.deepEqual(recentChanges, [true]);

    view.update(state([]));
    assert.equal(toggle.checked, true);
  });

  it('moves pins with the panel buttons and keeps the focus on the moved entry', () => {
    const { view, moved } = setup();
    view.update(state([repo('octo', 'alpha'), repo('octo', 'beta')]));
    view.open();

    const buttons = (name: string) =>
      [...view.root.querySelectorAll<HTMLButtonElement>('.ghx-header-pins__entry button')]
        .filter((button) => button.getAttribute('aria-label')?.includes(name) === true)
        .map((button) => [button.dataset['moveAction'] ?? 'unpin', button.disabled] as const);
    assert.deepEqual(buttons('alpha'), [
      ['up', true],
      ['down', false],
      ['unpin', false],
    ]);

    const down = view.root.querySelector<HTMLButtonElement>(
      '[aria-label="Move octo/alpha down"]',
    );
    down?.click();
    assert.deepEqual(moved, [['alpha', 1]]);

    view.update(state([repo('octo', 'beta'), repo('octo', 'alpha')]));
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Move octo/alpha up');

    view.root.querySelector<HTMLButtonElement>('[aria-label="Move octo/beta down"]')?.click();
    view.update(state([repo('octo', 'alpha'), repo('octo', 'beta')]));
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'Move octo/beta up');
    view.update(state([repo('octo', 'alpha'), repo('octo', 'beta')]));
  });

  it('reorders pins by dragging them along the bar', () => {
    const { view, moved } = setup();
    view.update(
      state([repo('octo', 'alpha'), repo('octo', 'beta'), repo('octo', 'gamma')], {
        recent: repo('octo', 'delta'),
      }),
    );
    const items = [...view.root.querySelectorAll<HTMLElement>('.ghx-header-pins__item')];
    items.forEach((item, index) => {
      item.getBoundingClientRect = () => ({ left: index * 100, width: 80 }) as DOMRect;
    });
    assert.deepEqual(
      items.map((item) => item.dataset['pinIndex'] ?? 'auto'),
      ['0', '1', '2', 'auto'],
    );
    assert.equal(items[0]?.querySelector('a')?.getAttribute('draggable'), 'false');

    const pointer = (type: string, x: number, target: EventTarget = document) =>
      target.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true }),
      );
    const alpha = items[0]?.querySelector('a');
    assert.ok(alpha);
    pointer('pointerdown', 40, alpha);
    pointer('pointermove', 42);
    assert.equal(items[0]?.classList.contains('ghx-header-pins__item--dragging'), false);
    pointer('pointermove', 250);
    assert.equal(items[0]?.classList.contains('ghx-header-pins__item--dragging'), true);
    assert.equal(items[2]?.classList.contains('ghx-header-pins__item--drop-after'), true);
    pointer('pointerup', 250);
    assert.deepEqual(moved, [['alpha', 2]]);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    alpha.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    view.dispose();
  });
});
