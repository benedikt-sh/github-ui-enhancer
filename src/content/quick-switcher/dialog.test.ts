import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import { DIALOG_ATTRIBUTE, openQuickSwitcherDialog, TOKEN_HINT } from './dialog.ts';
import type { QuickSwitcherDialog, QuickSwitcherDialogOptions } from './dialog.ts';
import type { Results, SwitcherEntry } from './results.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

function entry(fullName: string, overrides: Partial<SwitcherEntry> = {}): SwitcherEntry {
  return {
    key: fullName.toLowerCase(),
    fullName,
    url: `https://github.com/${fullName}`,
    description: null,
    visibility: 'public',
    archived: false,
    fork: false,
    nameHighlights: [],
    descriptionHighlights: [],
    recent: false,
    ...overrides,
  };
}

const ENTRIES = [entry('acme/one'), entry('acme/two'), entry('acme/three')];

function results(entries: readonly SwitcherEntry[], extra: Partial<Results> = {}): Results {
  return { entries, state: null, partialErrors: [], ...extra };
}

interface Setup {
  readonly dialog: QuickSwitcherDialog;
  readonly queries: string[];
  readonly opened: [string, boolean][];
  readonly timers: (() => void)[];
  readonly counts: { closed: number; retried: number; settings: number };
  setResults(value: Results): void;
}

let current: Setup | null = null;

function setup(
  initial: Results = results(ENTRIES),
  overrides: Partial<QuickSwitcherDialogOptions> = {},
): Setup {
  let value = initial;
  const queries: string[] = [];
  const opened: [string, boolean][] = [];
  const timers: (() => void)[] = [];
  const counts = { closed: 0, retried: 0, settings: 0 };
  const dialog = openQuickSwitcherDialog({
    document,
    window: {
      setTimeout: ((callback: () => void) => {
        timers.push(callback);
        return 0;
      }) as Window['setTimeout'],
    },
    results(query) {
      queries.push(query);
      return value;
    },
    openUrl: (url, newTab) => opened.push([url, newTab]),
    onRetry: () => {
      counts.retried += 1;
    },
    openOptions: () => {
      counts.settings += 1;
    },
    onClose: () => {
      counts.closed += 1;
    },
    ...overrides,
  });
  current = {
    dialog,
    queries,
    opened,
    timers,
    counts,
    setResults(next) {
      value = next;
    },
  };
  return current;
}

beforeEach(() => {
  document.body.innerHTML = '<button id="before">Before</button><input id="outside">';
  document.getElementById('before')?.focus();
});

afterEach(() => {
  current?.dialog.close();
  current = null;
});

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('.ghx-quick-switcher__input');
  assert.ok(element);
  return element;
}

function key(target: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function type(text: string): void {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

function options(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('[role="option"]')];
}

function selected(): string[] {
  return options()
    .filter((option) => option.getAttribute('aria-selected') === 'true')
    .map((option) => option.dataset['key'] ?? '');
}

function activeDescendant(): string | null {
  const id = input().getAttribute('aria-activedescendant');
  return id === null ? null : (document.getElementById(id)?.dataset['key'] ?? 'missing');
}

describe('openQuickSwitcherDialog', () => {
  it('opens a modal combobox with the first entry active', () => {
    const { dialog, queries } = setup();
    const modal = document.querySelector('[role="dialog"]');
    assert.equal(modal?.getAttribute('aria-modal'), 'true');
    assert.equal(
      document.getElementById(modal?.getAttribute('aria-labelledby') ?? '')?.textContent,
      'Open a repository',
    );
    assert.ok(dialog.root.hasAttribute(DIALOG_ATTRIBUTE));
    assert.equal(dialog.root.parentElement, document.body);
    assert.equal(document.activeElement, input());
    assert.equal(input().getAttribute('role'), 'combobox');
    assert.equal(input().getAttribute('aria-expanded'), 'true');
    const list = document.getElementById(input().getAttribute('aria-controls') ?? '');
    assert.equal(list?.getAttribute('role'), 'listbox');
    assert.deepEqual(queries, ['']);
    assert.deepEqual(selected(), ['acme/one']);
    assert.equal(activeDescendant(), 'acme/one');
    assert.equal(options()[0]?.getAttribute('href'), 'https://github.com/acme/one');
  });

  it('removes lifeless copies of an earlier dialog', () => {
    const stale = document.createElement('div');
    stale.setAttribute(DIALOG_ATTRIBUTE, '');
    document.body.append(stale);
    setup();
    assert.equal(stale.isConnected, false);
    assert.equal(document.querySelectorAll(`[${DIALOG_ATTRIBUTE}]`).length, 1);
  });

  it('searches on input and activates the first result', () => {
    const { queries, setResults } = setup();
    key(input(), 'ArrowDown');
    setResults(results([entry('acme/two'), entry('acme/three')]));
    type('t');
    assert.deepEqual(queries, ['', 't']);
    assert.deepEqual(selected(), ['acme/two']);
  });

  it('moves the selection with arrows, wrapping around, and with Home and End', () => {
    setup();
    const down = key(input(), 'ArrowDown');
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(selected(), ['acme/two']);
    key(input(), 'ArrowDown');
    key(input(), 'ArrowDown');
    assert.deepEqual(selected(), ['acme/one']);
    key(input(), 'ArrowUp');
    assert.deepEqual(selected(), ['acme/three']);
    assert.equal(activeDescendant(), 'acme/three');
    key(input(), 'Home');
    assert.deepEqual(selected(), ['acme/one']);
    key(input(), 'End');
    assert.deepEqual(selected(), ['acme/three']);
    key(input(), 'ArrowUp');
    assert.deepEqual(selected(), ['acme/two']);
  });

  it('leaves navigation keys alone without entries', () => {
    setup(results([], { state: { kind: 'no-match', query: 'x' } }));
    const down = key(input(), 'ArrowDown');
    const home = key(input(), 'Home');
    assert.equal(down.defaultPrevented, false);
    assert.equal(home.defaultPrevented, false);
    assert.equal(input().getAttribute('aria-expanded'), 'false');
    assert.equal(input().hasAttribute('aria-activedescendant'), false);
    assert.equal(key(input(), 'Enter').defaultPrevented, false);
  });

  it('opens the active repository in the same tab on Enter and closes', () => {
    const { opened, counts } = setup();
    key(input(), 'ArrowDown');
    const event = key(input(), 'Enter');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(opened, [['https://github.com/acme/two', false]]);
    assert.equal(counts.closed, 1);
    assert.equal(document.querySelector(`[${DIALOG_ATTRIBUTE}]`), null);
  });

  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    it(`opens a new tab with ${modifier} and Enter`, () => {
      const { opened } = setup();
      key(input(), 'Enter', { [modifier]: true });
      assert.deepEqual(opened, [['https://github.com/acme/one', true]]);
    });
  }

  it('ignores keys that confirm an IME composition', () => {
    const { opened } = setup();
    const event = key(input(), 'Enter', { isComposing: true });
    key(input(), 'Escape', { isComposing: true });
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(opened, []);
    assert.ok(document.querySelector(`[${DIALOG_ATTRIBUTE}]`));
  });

  it('keeps typed keys away from GitHub shortcuts without blocking typing', () => {
    setup();
    const seen: string[] = [];
    const listener = (event: KeyboardEvent): void => {
      seen.push(event.key);
    };
    document.addEventListener('keydown', listener);
    const event = key(input(), 's');
    key(input(), 'ArrowDown');
    document.removeEventListener('keydown', listener);
    assert.deepEqual(seen, []);
    assert.equal(event.defaultPrevented, false);
  });

  it('closes on Escape and restores the previous focus', () => {
    const { counts } = setup();
    const event = key(input(), 'Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(counts.closed, 1);
    assert.equal(document.activeElement?.id, 'before');
    assert.equal(document.querySelector(`[${DIALOG_ATTRIBUTE}]`), null);
  });

  it('closes only once', () => {
    const { dialog, counts } = setup();
    dialog.close();
    dialog.close();
    assert.equal(counts.closed, 1);
  });

  it('does not restore the focus to an element that is gone', () => {
    const { dialog } = setup();
    document.getElementById('before')?.remove();
    dialog.close();
    assert.notEqual(document.activeElement?.id, 'before');
  });

  it('closes on a click on the backdrop but not inside the dialog', () => {
    const { dialog, counts } = setup();
    const inside = document.querySelector('.ghx-quick-switcher__dialog');
    inside?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert.equal(counts.closed, 0);
    dialog.root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert.equal(counts.closed, 1);
  });

  it('traps Tab inside the dialog', () => {
    setup(
      results([], {
        state: { kind: 'error', errors: [{ kind: 'unauthorized', message: 'bad' }] },
      }),
    );
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.ghx-quick-switcher button')];
    assert.deepEqual(
      buttons.map((element) => element.textContent),
      ['Open settings', 'Retry'],
    );
    const tab = key(input(), 'Tab');
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement, buttons[0]);
    key(buttons[0] as Element, 'Tab');
    assert.equal(document.activeElement, buttons[1]);
    key(buttons[1] as Element, 'Tab');
    assert.equal(document.activeElement, input());
    key(input(), 'Tab', { shiftKey: true });
    assert.equal(document.activeElement, buttons[1]);
  });

  it('only moves the selection while the input has the focus', () => {
    setup(
      results(ENTRIES, {
        state: { kind: 'error', errors: [{ kind: 'network', message: 'offline' }] },
      }),
    );
    const retry = document.querySelector<HTMLButtonElement>('.ghx-quick-switcher button');
    assert.ok(retry);
    retry.focus();
    const event = key(retry, 'ArrowDown');
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(selected(), ['acme/one']);
  });

  it('starts the Tab cycle at the input when the focus is elsewhere', () => {
    setup();
    const dialogElement = document.querySelector('.ghx-quick-switcher__dialog');
    assert.ok(dialogElement);
    (document.activeElement as HTMLElement | null)?.blur();
    key(dialogElement, 'Tab');
    assert.equal(document.activeElement, input());
  });

  it('pulls the focus back when it leaves the dialog', () => {
    setup();
    document.getElementById('outside')?.focus();
    assert.equal(document.activeElement, input());
  });

  it('lets the focus go once closed', () => {
    const { dialog } = setup();
    dialog.close();
    document.getElementById('outside')?.focus();
    assert.equal(document.activeElement?.id, 'outside');
  });

  it('keeps the active entry on update while it is listed', () => {
    const { dialog, setResults, queries } = setup();
    key(input(), 'ArrowDown');
    setResults(results([entry('acme/new'), ...ENTRIES]));
    dialog.update();
    assert.deepEqual(selected(), ['acme/two']);
    setResults(results([entry('acme/new')]));
    dialog.update();
    assert.deepEqual(selected(), ['acme/new']);
    assert.equal(queries.length, 3);
  });

  it('ignores updates after closing', () => {
    const { dialog, queries } = setup();
    dialog.close();
    dialog.update();
    assert.equal(queries.length, 1);
  });

  it('focuses the input and selects the query on focus', () => {
    const { dialog } = setup();
    type('acme');
    document.getElementById('before')?.focus();
    dialog.focus();
    assert.equal(document.activeElement, input());
    assert.equal(input().selectionStart, 0);
    assert.equal(input().selectionEnd, 4);
  });

  it('keeps the focus in the dialog when a retry replaces the focused button', () => {
    const error: ApiErrorInfo = { kind: 'network', message: 'offline' };
    const { dialog, counts, setResults } = setup(
      results([], { state: { kind: 'error', errors: [error] } }),
    );
    const retry = [...document.querySelectorAll<HTMLButtonElement>('.ghx-quick-switcher button')]
      .find((element) => element.textContent === 'Retry');
    assert.ok(retry);
    retry.focus();
    retry.click();
    assert.equal(counts.retried, 1);
    setResults(results([], { state: { kind: 'loading' } }));
    dialog.update();
    assert.equal(document.activeElement, input());
  });

  it('does not take the focus on update when it was elsewhere', () => {
    const { dialog } = setup();
    const outside = document.getElementById('outside');
    dialog.close();
    outside?.focus();
    dialog.update();
    assert.equal(document.activeElement, outside);
  });

  describe('states', () => {
    function stateText(): string {
      return document.querySelector('.ghx-quick-switcher__state')?.textContent ?? '';
    }

    it('shows the loading state below early entries', () => {
      setup(results([entry('acme/web', { recent: true })], { state: { kind: 'loading' } }));
      assert.equal(options().length, 1);
      assert.match(stateText(), /Loading repositories/);
    });

    it('shows load errors with a token hint and a settings button', () => {
      const { counts } = setup(
        results([], {
          state: {
            kind: 'error',
            errors: [{ kind: 'unauthorized', message: 'bad', owner: 'acme' }],
          },
        }),
      );
      assert.match(stateText(), /Could not load repositories/);
      assert.match(stateText(), /The token for acme is invalid or has expired/);
      assert.ok(stateText().includes(TOKEN_HINT));
      document.querySelector<HTMLButtonElement>('.ghx-quick-switcher__state button')?.click();
      assert.equal(counts.settings, 1);
    });

    it('shows other errors without the token hint', () => {
      setup(results([], { state: { kind: 'error', errors: [{ kind: 'network', message: 'x' }] } }));
      assert.match(stateText(), /could not be reached/);
      assert.equal(stateText().includes(TOKEN_HINT), false);
      const labels = [...document.querySelectorAll('.ghx-quick-switcher__state button')].map(
        (element) => element.textContent,
      );
      assert.deepEqual(labels, ['Retry']);
    });

    it('offers no settings button without a way to open the settings', () => {
      setup(
        results([], { state: { kind: 'error', errors: [{ kind: 'forbidden', message: 'x' }] } }),
        { openOptions: undefined },
      );
      assert.ok(stateText().includes(TOKEN_HINT));
      const labels = [...document.querySelectorAll('.ghx-quick-switcher__state button')].map(
        (element) => element.textContent,
      );
      assert.deepEqual(labels, ['Retry']);
    });

    it('explains missing tokens', () => {
      const { counts } = setup(results([], { state: { kind: 'no-tokens' } }));
      assert.match(stateText(), /No access token configured/);
      assert.ok(stateText().includes(TOKEN_HINT));
      document.querySelector<HTMLButtonElement>('.ghx-quick-switcher__state button')?.click();
      assert.equal(counts.settings, 1);
    });

    it('explains missing tokens without a settings button', () => {
      setup(results([], { state: { kind: 'no-tokens' } }), { openOptions: undefined });
      assert.ok(stateText().includes(TOKEN_HINT));
      assert.equal(document.querySelector('.ghx-quick-switcher__state button'), null);
    });

    it('explains an empty index', () => {
      setup(results([], { state: { kind: 'no-repos' } }));
      assert.match(stateText(), /No repositories found/);
    });

    it('explains queries without results', () => {
      const { setResults } = setup(results([], { state: { kind: 'no-match', query: '' } }));
      assert.match(stateText(), /Type to search your repositories/);
      setResults(results([], { state: { kind: 'no-match', query: 'zzz' } }));
      type('zzz');
      assert.match(stateText(), /No repositories match "zzz"/);
    });

    it('shows partial errors above the results', () => {
      const { setResults } = setup(
        results(ENTRIES, {
          partialErrors: [
            { kind: 'unauthorized', message: 'bad', owner: 'globex' },
            { kind: 'unauthorized', message: 'bad', owner: 'globex' },
          ],
        }),
      );
      const notice = (): string =>
        document.querySelector('.ghx-quick-switcher__notice')?.textContent ?? '';
      assert.equal(
        notice(),
        'Some repositories could not be loaded. The token for globex is invalid or has ' +
          `expired. ${TOKEN_HINT}`,
      );
      assert.equal(stateText(), '');
      setResults(results(ENTRIES, { partialErrors: [{ kind: 'network', message: 'x' }] }));
      type('a');
      assert.equal(notice().includes(TOKEN_HINT), false);
      setResults(results(ENTRIES));
      type('ab');
      assert.equal(notice(), '');
    });
  });

  describe('mouse', () => {
    it('keeps the focus in the input when an option is pressed', () => {
      setup();
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      options()[1]?.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });

    it('activates the option under the mouse', () => {
      setup();
      options()[2]
        ?.querySelector('.ghx-quick-switcher__repo')
        ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      assert.deepEqual(selected(), ['acme/three']);
      options()[2]?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      assert.deepEqual(selected(), ['acme/three']);
      document
        .querySelector('.ghx-quick-switcher__list')
        ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      assert.deepEqual(selected(), ['acme/three']);
    });

    it('closes after a plain click, once the link has been followed', () => {
      const { timers, counts } = setup();
      const option = options()[0];
      option?.addEventListener('click', (event) => event.preventDefault());
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(counts.closed, 0);
      assert.equal(timers.length, 1);
      timers[0]?.();
      assert.equal(counts.closed, 1);
    });

    it('stays open after clicks that open the repository elsewhere', () => {
      const { timers } = setup();
      const option = options()[0];
      option?.addEventListener('click', (event) => event.preventDefault());
      for (const init of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        option?.dispatchEvent(event);
      }
      document
        .querySelector('.ghx-quick-switcher__list')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert.equal(timers.length, 0);
    });
  });

  describe('options', () => {
    it('renders the owner, highlights, description, markers and the recent hint', () => {
      setup(
        results([
          entry('acme/billing-api', {
            description: 'Handles invoices',
            visibility: 'private',
            archived: true,
            fork: true,
            recent: true,
            nameHighlights: [[0, 2], [5, 12]],
            descriptionHighlights: [[8, 16]],
          }),
          entry('globex/ui', { visibility: 'internal' }),
          entry('other/thing', { visibility: null }),
        ]),
      );
      const [first, second, third] = options();
      assert.equal(first?.querySelector('.ghx-quick-switcher__owner')?.textContent, 'acme/');
      assert.equal(first?.querySelector('.ghx-quick-switcher__repo')?.textContent, 'billing-api');
      assert.deepEqual(
        [...(first?.querySelectorAll('mark') ?? [])].map((mark) => mark.textContent),
        ['ac', 'billing', 'invoices'],
      );
      assert.equal(
        first?.querySelector('.ghx-quick-switcher__description')?.textContent,
        'Handles invoices',
      );
      assert.deepEqual(
        [...(first?.querySelectorAll('.ghx-quick-switcher__badge') ?? [])].map(
          (badge) => badge.textContent,
        ),
        ['Private', 'Archived', 'Fork'],
      );
      assert.equal(first?.querySelector('.ghx-quick-switcher__recent')?.textContent, 'Recent');
      assert.equal(
        first?.querySelector('.ghx-quick-switcher__visibility svg')?.getAttribute('aria-label'),
        'Private repository',
      );
      assert.ok(first?.querySelector('.ghx-quick-switcher__visibility--restricted'));
      assert.equal(second?.querySelector('.ghx-quick-switcher__badge')?.textContent, 'Internal');
      assert.equal(
        third?.querySelector('.ghx-quick-switcher__visibility svg')?.getAttribute('aria-hidden'),
        'true',
      );
      assert.equal(third?.querySelector('.ghx-quick-switcher__badge'), null);
      assert.equal(third?.querySelector('.ghx-quick-switcher__description'), null);
      assert.equal(third?.getAttribute('tabindex'), '-1');
    });
  });
});
