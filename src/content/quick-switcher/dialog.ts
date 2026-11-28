import type { ApiErrorInfo } from '../../shared/errors.ts';
import { h, uniqueId } from '../../ui/dom.ts';
import { button } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import {
  describeApiError,
  emptyState,
  errorState,
  isTokenError,
  loadingState,
  uniqueErrors,
} from '../../ui/states.ts';
import type { Results, ResultsState, SwitcherEntry } from './results.ts';
import { switcherOption } from './switcher-option.ts';

export type OpenUrl = (url: string, newTab: boolean) => void;

/** Marks the overlay, also lifeless copies a page snapshot of GitHub's Turbo may restore. */
export const DIALOG_ATTRIBUTE = 'data-ghx-quick-switcher';
export const TOKEN_HINT = 'Access tokens are configured in the extension settings.';

export interface QuickSwitcherDialogOptions {
  readonly document: Document;
  readonly window: Pick<Window, 'setTimeout'>;
  /** Called for the current query on every input and every `update`. */
  readonly results: (query: string) => Results;
  readonly openUrl: OpenUrl;
  readonly onRetry: () => void;
  /** Without it, token problems only get a hint instead of a settings button. */
  readonly openOptions?: (() => void) | undefined;
  /** Called once after the dialog closed, whatever closed it. */
  readonly onClose: () => void;
}

export interface QuickSwitcherDialog {
  readonly root: HTMLElement;
  /** Focuses the input and selects the query, e.g. when the shortcut is pressed again. */
  focus(): void;
  /** Renders fresh results, the active entry stays selected while it is still listed. */
  update(): void;
  /** Removes the dialog and gives the focus back to where it was before. Idempotent. */
  close(): void;
}

const FOCUSABLE = 'input, button, a[href]';

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function hasTokenError(errors: readonly ApiErrorInfo[]): boolean {
  return errors.some((error) => isTokenError(error.kind));
}

function kbd(...keys: string[]): HTMLElement[] {
  return keys.map((key) => h('kbd', { className: 'ghx-quick-switcher__kbd' }, key));
}

/** Modal search over the user's repositories, opened on top of any GitHub page. */
export function openQuickSwitcherDialog(options: QuickSwitcherDialogOptions): QuickSwitcherDialog {
  const { document, window, openUrl, openOptions } = options;
  const previousFocus = document.activeElement;
  let entries: readonly SwitcherEntry[] = [];
  let activeIndex = -1;
  /** Set once the user moved the selection, until the query changes. */
  let userSelected = false;
  let closed = false;

  const listId = uniqueId('ghx-quick-switcher-list');
  const titleId = uniqueId('ghx-quick-switcher-title');
  const optionId = (position: number): string => `${listId}-option-${position}`;

  const input = h('input', {
    className: 'ghx-quick-switcher__input',
    type: 'text',
    role: 'combobox',
    placeholder: 'Search repositories',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Search repositories',
    'aria-autocomplete': 'list',
    'aria-controls': listId,
    'aria-expanded': 'false',
    on: {
      input: () => {
        userSelected = false;
        render();
      },
    },
  });
  const list = h('ul', {
    className: 'ghx-quick-switcher__list',
    id: listId,
    role: 'listbox',
    'aria-label': 'Repositories',
    on: {
      // Keeps the focus in the input, the click still follows the link.
      mousedown: (event) => event.preventDefault(),
      mousemove: onListHover,
      click: onListClick,
    },
  });
  const notice = h('div', { className: 'ghx-quick-switcher__notice' });
  const state = h('div', { className: 'ghx-quick-switcher__state' });
  const dialog = h(
    'div',
    {
      className: 'ghx-quick-switcher__dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      on: { keydown: onKeyDown },
    },
    h('h2', { className: 'ghx-quick-switcher__title', id: titleId }, 'Open a repository'),
    h(
      'div',
      { className: 'ghx-quick-switcher__header' },
      icon('search', { className: 'ghx-quick-switcher__search-icon' }),
      input,
    ),
    notice,
    h('div', { className: 'ghx-quick-switcher__body' }, list, state),
    h(
      'div',
      { className: 'ghx-quick-switcher__footer', 'aria-hidden': 'true' },
      h('span', null, kbd('↑', '↓'), ' to navigate'),
      h('span', null, kbd('Enter'), ' to open'),
      h('span', null, kbd('Ctrl', 'Enter'), ' new tab'),
      h('span', null, kbd('Esc'), ' to close'),
    ),
  );
  const root = h(
    'div',
    {
      className: 'ghx-quick-switcher',
      dataset: { ghxQuickSwitcher: '' },
      on: {
        mousedown: (event) => {
          if (event.target === root) {
            close();
          }
        },
      },
    },
    dialog,
  );

  for (const stale of document.querySelectorAll(`[${DIALOG_ATTRIBUTE}]`)) {
    stale.remove();
  }
  (document.body ?? document.documentElement).append(root);
  document.addEventListener('focusin', onFocusIn);
  render();
  input.focus();

  /** The first entry is active, unless the user picked one that is still listed. */
  function render(): void {
    const hadFocus = dialog.contains(document.activeElement);
    const activeKey = userSelected ? entries[activeIndex]?.key : undefined;
    const results = options.results(input.value);
    entries = results.entries;
    const kept = entries.findIndex((entry) => entry.key === activeKey);
    activeIndex = kept !== -1 ? kept : entries.length > 0 ? 0 : -1;

    list.replaceChildren(
      ...entries.map((entry, position) =>
        switcherOption({ entry, id: optionId(position), active: position === activeIndex }),
      ),
    );
    input.setAttribute('aria-expanded', String(entries.length > 0));
    syncActiveDescendant();
    notice.replaceChildren(...partialNotice(results.partialErrors));
    const stateElement = results.state === null ? null : renderState(results.state);
    state.replaceChildren(...(stateElement === null ? [] : [stateElement]));
    // A retry replaces the focused button, the focus must not fall out of the dialog.
    if (hadFocus && !dialog.contains(document.activeElement)) {
      input.focus();
    }
  }

  function partialNotice(errors: readonly ApiErrorInfo[]): Element[] {
    if (errors.length === 0) {
      return [];
    }
    const text = uniqueErrors(errors).map(describeApiError).join(' ');
    return [
      icon('alert'),
      h(
        'span',
        null,
        `Some repositories could not be loaded. ${text}`,
        hasTokenError(errors) ? ` ${TOKEN_HINT}` : null,
      ),
    ];
  }

  function settingsActions(): HTMLButtonElement[] {
    return openOptions === undefined
      ? []
      : [button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: openOptions })];
  }

  function renderState(value: ResultsState): HTMLElement {
    switch (value.kind) {
      case 'loading':
        return loadingState('Loading repositories...');
      case 'error': {
        const element = errorState(value.errors, {
          title: 'Could not load repositories',
          onRetry: options.onRetry,
          ...(openOptions === undefined ? {} : { onOpenSettings: openOptions }),
        });
        if (hasTokenError(value.errors)) {
          element.append(h('p', { className: 'ghx-state__description' }, TOKEN_HINT));
        }
        return element;
      }
      case 'no-tokens':
        return emptyState({
          icon: 'gear',
          title: 'No access token configured',
          description: TOKEN_HINT,
          actions: settingsActions(),
        });
      case 'no-repos':
        return emptyState({
          icon: 'repo',
          title: 'No repositories found',
          description: 'Your tokens do not grant access to any repository.',
        });
      case 'no-match':
        return emptyState({
          icon: 'search',
          title:
            value.query === ''
              ? 'Type to search your repositories'
              : `No repositories match "${value.query}"`,
        });
    }
  }

  function syncActiveDescendant(): void {
    if (activeIndex === -1) {
      input.removeAttribute('aria-activedescendant');
    } else {
      input.setAttribute('aria-activedescendant', optionId(activeIndex));
    }
  }

  function setActive(position: number, scroll: boolean): void {
    activeIndex = position;
    userSelected = true;
    const optionElements = list.querySelectorAll('[role="option"]');
    optionElements.forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === position));
    });
    syncActiveDescendant();
    if (scroll) {
      optionElements[position]?.scrollIntoView({ block: 'nearest' });
    }
  }

  function openActive(newTab: boolean): void {
    const entry = entries[activeIndex];
    if (entry !== undefined) {
      close();
      openUrl(entry.url, newTab);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Keys confirming an IME composition belong to the composition.
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      consume(event);
      close();
      return;
    }
    if (event.key === 'Tab') {
      consume(event);
      cycleFocus(event.shiftKey ? -1 : 1);
      return;
    }
    // Keeps GitHub's own keyboard shortcuts from reacting to anything typed here.
    event.stopPropagation();
    if (event.target !== input || entries.length === 0) {
      return;
    }
    const last = entries.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive(activeIndex >= last ? 0 : activeIndex + 1, true);
        break;
      case 'ArrowUp':
        setActive(activeIndex <= 0 ? last : activeIndex - 1, true);
        break;
      case 'Home':
        setActive(0, true);
        break;
      case 'End':
        setActive(last, true);
        break;
      case 'Enter':
        openActive(event.ctrlKey || event.metaKey);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function cycleFocus(step: number): void {
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.getAttribute('tabindex') !== '-1' && !element.hasAttribute('disabled'),
    );
    const current = focusable.findIndex((element) => element === document.activeElement);
    const next = (current + step + focusable.length) % focusable.length;
    focusable[current === -1 ? 0 : next]?.focus();
  }

  function onFocusIn(event: FocusEvent): void {
    if (event.target instanceof Node && !root.contains(event.target)) {
      input.focus();
    }
  }

  function optionOf(event: Event): HTMLElement | null {
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>('[role="option"]')
      : null;
  }

  function onListHover(event: MouseEvent): void {
    const key = optionOf(event)?.dataset['key'];
    const position = entries.findIndex((entry) => entry.key === key);
    if (position !== -1 && position !== activeIndex) {
      setActive(position, false);
    }
  }

  function onListClick(event: MouseEvent): void {
    const plain = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (optionOf(event) !== null && plain && !event.altKey) {
      // Closed after the click, so the link navigates as usual. Modified clicks open the repo
      // elsewhere and leave the dialog open for more.
      window.setTimeout(close, 0);
    }
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    document.removeEventListener('focusin', onFocusIn);
    root.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    options.onClose();
  }

  return {
    root,
    focus() {
      input.focus();
      input.select();
    },
    update() {
      if (!closed) {
        render();
      }
    },
    close,
  };
}
