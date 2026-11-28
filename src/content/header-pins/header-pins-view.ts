import { repoFullName } from '../../shared/repo.ts';
import type { RepoRef, RepoSummary } from '../../shared/types.ts';
import { h, safeUrl, uniqueId } from '../../ui/dom.ts';
import { button, checkbox, iconButton } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import type { IconName } from '../../ui/octicons.ts';
import { attachPinDrag } from './pin-drag.ts';
import { isPinned, MAX_PINS, repoKey } from './pins-settings.ts';
import type { PinsSettings } from './pins-settings.ts';
import { createRepoPicker } from './repo-picker.ts';

/** Marks the extension's element in GitHub's header, also stale copies Turbo restores. */
export const PINS_ATTRIBUTE = 'data-ghx-header-pins';
/** Set on `<html>` while the panel is open, `header-pins.css` lifts the header above the page. */
export const PANEL_OPEN_ATTRIBUTE = 'data-ghx-header-pins-open';

export interface HeaderPinsState {
  readonly settings: PinsSettings;
  /** Automatic pin, already left out by the caller when it is pinned anyway. */
  readonly recent: RepoRef | null;
  /** Shown in the panel, e.g. when saving failed. */
  readonly error: string | null;
}

export interface HeaderPinsViewOptions {
  readonly document: Document;
  readonly loadRepos: () => Promise<readonly RepoSummary[]>;
  readonly onAdd: (repo: RepoRef) => void;
  readonly onRemove: (repo: RepoRef) => void;
  /** Moves a pinned repo to a new position, by dragging in the bar or with the panel buttons. */
  readonly onMove: (repo: RepoRef, index: number) => void;
  readonly onRecentChange: (recent: boolean) => void;
  readonly now?: (() => number) | undefined;
}

export interface HeaderPinsView {
  readonly root: HTMLDivElement;
  update(state: HeaderPinsState): void;
  isOpen(): boolean;
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
  /** Closes the panel and removes document listeners, the caller removes `root`. */
  dispose(): void;
}

export function repoUrl(repo: RepoRef): string | null {
  return safeUrl(`https://github.com/${repoFullName(repo)}`);
}

const LIMIT_HINT = `You can pin up to ${MAX_PINS} repositories. Unpin one to add another.`;

export function createHeaderPinsView(options: HeaderPinsViewOptions): HeaderPinsView {
  const { document } = options;
  const panelId = uniqueId('ghx-header-pins-panel');
  const titleId = `${panelId}-title`;
  let state: HeaderPinsState | null = null;
  let picker: ReturnType<typeof createRepoPicker> | null = null;
  /** Button to focus again after a move re-rendered the panel entries. */
  let pendingFocus: { readonly key: string; readonly action: 'up' | 'down' } | null = null;

  const list = h('ul', { className: 'ghx-header-pins__list' });
  const nav = h(
    'nav',
    { className: 'ghx-header-pins__nav', 'aria-label': 'Pinned repositories' },
    list,
  );

  const trigger = h(
    'button',
    {
      type: 'button',
      className: ['ghx-btn', 'ghx-btn--invisible', 'ghx-btn--icon', 'ghx-header-pins__trigger'],
      'aria-label': 'Manage pinned repositories',
      title: 'Manage pinned repositories',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': panelId,
      on: { click: () => (isOpen() ? close() : open()) },
    },
    icon('chevron-down'),
  );

  const count = h('span', { className: 'ghx-header-pins__count' });
  const entries = h('ul', { className: 'ghx-header-pins__entries' });
  const empty = h('p', { className: 'ghx-header-pins__empty' }, 'No pinned repositories yet.');
  const addButton = button({
    label: 'Add repository',
    icon: 'plus',
    size: 'small',
    className: 'ghx-header-pins__add',
    onClick: openPicker,
  });
  const limitHint = h('p', { className: 'ghx-hint ghx-header-pins__limit' }, LIMIT_HINT);
  const pickerSlot = h('div', { className: 'ghx-header-pins__picker' });
  const error = h('p', { className: 'ghx-header-pins__error', role: 'alert' });
  const recentToggle = checkbox({
    label: 'Pin the repository you were active in most recently',
    hint: 'Based on your latest pushes, pull requests and new branches.',
    onChange: (checked) => options.onRecentChange(checked),
  });

  const panel = h(
    'div',
    {
      className: 'ghx-header-pins__panel',
      id: panelId,
      role: 'dialog',
      'aria-labelledby': titleId,
      hidden: true,
      on: { keydown: onPanelKeydown },
    },
    h(
      'div',
      { className: 'ghx-header-pins__heading' },
      h('h2', { className: 'ghx-header-pins__title', id: titleId }, 'Pinned repositories'),
      count,
    ),
    entries,
    empty,
    error,
    pickerSlot,
    addButton,
    limitHint,
    h('div', { className: 'ghx-header-pins__options' }, recentToggle.root),
  );

  const root = h(
    'div',
    { className: 'ghx-header-pins', [PINS_ATTRIBUTE]: true },
    nav,
    h('div', { className: 'ghx-header-pins__manage' }, trigger, panel),
  );

  function pinLink(repo: RepoRef, kind: 'pinned' | 'recent', index: number): HTMLLIElement {
    const fullName = repoFullName(repo);
    const label = kind === 'recent' ? `${fullName} (your most recent activity)` : fullName;
    const iconName: IconName = kind === 'recent' ? 'clock' : 'repo';
    return h(
      'li',
      {
        className: 'ghx-header-pins__item',
        dataset: kind === 'pinned' ? { pinIndex: String(index) } : undefined,
      },
      h(
        'a',
        {
          className: ['ghx-header-pins__link', `ghx-header-pins__link--${kind}`],
          href: repoUrl(repo),
          title: label,
          'aria-label': label,
          // Native link dragging would start before our own pointer based reordering.
          draggable: 'false',
        },
        icon(iconName),
        h('span', { className: 'ghx-header-pins__name' }, repo.name),
      ),
    );
  }

  function moveButton(repo: RepoRef, index: number, action: 'up' | 'down'): HTMLButtonElement {
    const count = state?.settings.repos.length ?? 0;
    const target = action === 'up' ? index - 1 : index + 1;
    const moveButton = iconButton({
      icon: action === 'up' ? 'chevron-up' : 'chevron-down',
      label: `Move ${repoFullName(repo)} ${action}`,
      size: 'small',
      onClick: () => {
        pendingFocus = { key: repoKey(repo), action };
        options.onMove(repo, target);
      },
    });
    moveButton.dataset['moveAction'] = action;
    moveButton.disabled = target < 0 || target >= count;
    return moveButton;
  }

  function entry(repo: RepoRef, index: number): HTMLLIElement {
    const fullName = repoFullName(repo);
    return h(
      'li',
      {
        className: 'ghx-header-pins__entry',
        dataset: { repoKey: repoKey(repo), pinIndex: String(index) },
        title: 'Drag to change the order',
      },
      icon('grabber', { className: 'ghx-header-pins__grabber' }),
      icon('repo'),
      h('a', { className: 'ghx-header-pins__entry-link', href: repoUrl(repo) }, fullName),
      moveButton(repo, index, 'up'),
      moveButton(repo, index, 'down'),
      iconButton({
        icon: 'x',
        label: `Unpin ${fullName}`,
        size: 'small',
        onClick: () => {
          options.onRemove(repo);
          focusAddOrTrigger();
        },
      }),
    );
  }

  function isFull(): boolean {
    return (state?.settings.repos.length ?? 0) >= MAX_PINS;
  }

  function update(next: HeaderPinsState): void {
    state = next;
    const { repos, recent } = next.settings;
    const links = repos.map((repo, index) => pinLink(repo, 'pinned', index));
    if (next.recent !== null) {
      links.push(pinLink(next.recent, 'recent', links.length));
    }
    list.replaceChildren(...links);
    nav.hidden = links.length === 0;
    count.textContent = `${repos.length} of ${MAX_PINS}`;
    entries.replaceChildren(...repos.map(entry));
    restoreMoveFocus();
    entries.hidden = repos.length === 0;
    empty.hidden = repos.length > 0;
    error.textContent = next.error ?? '';
    error.hidden = next.error === null;
    const full = isFull();
    if (full) {
      closePicker();
    }
    addButton.disabled = full;
    addButton.hidden = picker !== null;
    limitHint.hidden = !full;
    recentToggle.input.checked = recent;
  }

  function restoreMoveFocus(): void {
    const pending = pendingFocus;
    pendingFocus = null;
    if (pending === null) {
      return;
    }
    const moved = [...entries.children].find(
      (child) => child instanceof HTMLElement && child.dataset['repoKey'] === pending.key,
    );
    const buttons = [...(moved?.querySelectorAll('button') ?? [])];
    const same = buttons.find(
      (candidate) => candidate.dataset['moveAction'] === pending.action && !candidate.disabled,
    );
    // At the end of the list the button in the moved direction is disabled, so the other one
    // keeps the focus inside the entry.
    (same ?? buttons.find((candidate) => !candidate.disabled))?.focus();
  }

  function openPicker(): void {
    if (picker !== null || isFull()) {
      return;
    }
    picker = createRepoPicker({
      loadRepos: options.loadRepos,
      isExcluded: (repo) => state !== null && isPinned(state.settings, repo),
      onPick: (repo) => {
        closePicker();
        options.onAdd(repo);
        focusAddOrTrigger();
      },
      onCancel: () => {
        closePicker();
        addButton.focus();
      },
      now: options.now,
    });
    pickerSlot.append(picker.root);
    addButton.hidden = true;
    picker.input.focus();
  }

  function closePicker(): void {
    if (picker === null) {
      return;
    }
    picker.root.remove();
    picker = null;
    addButton.hidden = false;
  }

  function focusAddOrTrigger(): void {
    if (isOpen() && !addButton.disabled) {
      addButton.focus();
    } else {
      trigger.focus();
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  }

  const onDocumentPointer = (event: Event): void => {
    if (event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    close();
  };

  function isOpen(): boolean {
    return !panel.hidden;
  }

  function open(): void {
    if (isOpen()) {
      return;
    }
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.documentElement.setAttribute(PANEL_OPEN_ATTRIBUTE, '');
    document.addEventListener('mousedown', onDocumentPointer, true);
    document.addEventListener('focusin', onDocumentPointer, true);
    focusAddOrTrigger();
  }

  function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
    if (!isOpen()) {
      return;
    }
    closePicker();
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.documentElement.removeAttribute(PANEL_OPEN_ATTRIBUTE);
    document.removeEventListener('mousedown', onDocumentPointer, true);
    document.removeEventListener('focusin', onDocumentPointer, true);
    if (restoreFocus) {
      trigger.focus();
    }
  }

  const moveByIndex = (from: number, to: number): void => {
    const repo = state?.settings.repos[from];
    if (repo !== undefined) {
      options.onMove(repo, to);
    }
  };
  const detachBarDrag = attachPinDrag({ document, list, onMove: moveByIndex });
  const detachPanelDrag = attachPinDrag({
    document,
    list: entries,
    onMove: moveByIndex,
    axis: 'y',
    classes: {
      list: 'ghx-header-pins__entries--dragging',
      item: 'ghx-header-pins__entry--dragging',
      dropBefore: 'ghx-header-pins__entry--drop-before',
      dropAfter: 'ghx-header-pins__entry--drop-after',
    },
  });

  return {
    root,
    update,
    isOpen,
    open,
    close,
    dispose: () => {
      detachBarDrag();
      detachPanelDrag();
      close();
    },
  };
}
