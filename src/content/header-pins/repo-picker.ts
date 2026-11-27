import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { RepoSearcher, RepoSearchResult } from '../../lib/fuzzy.ts';
import { splitHighlights } from '../../lib/highlight.ts';
import type { RepoRef, RepoSummary } from '../../shared/types.ts';
import { h, uniqueId } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';

export const PICKER_LIMIT = 8;

export interface RepoPickerOptions {
  readonly loadRepos: () => Promise<readonly RepoSummary[]>;
  /** Repos hidden from the results, checked on every search. */
  readonly isExcluded: (repo: RepoRef) => boolean;
  readonly onPick: (repo: RepoRef) => void;
  /** Escape in the input. */
  readonly onCancel: () => void;
  /** Clock for the recency ranking of the search. */
  readonly now?: (() => number) | undefined;
}

export interface RepoPicker {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
}

/** Combobox over the repo index: type to filter, arrow keys to move, Enter to pick. */
export function createRepoPicker(options: RepoPickerOptions): RepoPicker {
  const listId = uniqueId('ghx-pin-picker');
  let searcher: RepoSearcher | null = null;
  let results: RepoSearchResult[] = [];
  let active = -1;

  const input = h('input', {
    type: 'text',
    className: ['ghx-input', 'ghx-pin-picker__input'],
    role: 'combobox',
    'aria-label': 'Find a repository to pin',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    placeholder: 'Find a repository...',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const list = h('ul', {
    className: 'ghx-pin-picker__list',
    id: listId,
    role: 'listbox',
    'aria-label': 'Repositories',
  });
  const status = h('p', { className: 'ghx-pin-picker__status', role: 'status' });
  const root = h('div', { className: 'ghx-pin-picker' }, input, list, status);

  const optionId = (index: number): string => `${listId}-option-${index}`;

  function setStatus(text: string): void {
    status.textContent = text;
    status.hidden = text === '';
  }

  function search(): void {
    if (searcher === null) {
      return;
    }
    // Over-fetch so that excluded repos do not shrink the visible results.
    const found = searcher.search(input.value, { limit: PICKER_LIMIT * 2 });
    results = found.filter((result) => !options.isExcluded(result.repo)).slice(0, PICKER_LIMIT);
    active = results.length > 0 ? 0 : -1;
    list.replaceChildren(...results.map(renderOption));
    input.setAttribute('aria-expanded', String(results.length > 0));
    setStatus(results.length > 0 ? '' : 'No matching repositories.');
    markActive();
  }

  function renderOption(result: RepoSearchResult, index: number): HTMLLIElement {
    const segments = splitHighlights(result.repo.fullName, result.highlights.fullName);
    return h(
      'li',
      {
        className: 'ghx-pin-picker__option',
        id: optionId(index),
        role: 'option',
        'aria-selected': 'false',
        on: {
          // Keeps the focus in the input, the click below still picks.
          mousedown: (event) => event.preventDefault(),
          click: () => pick(index),
        },
      },
      icon('repo'),
      h(
        'span',
        { className: 'ghx-pin-picker__name' },
        segments.map((segment) =>
          segment.highlighted
            ? h('mark', { className: 'ghx-pin-picker__match' }, segment.text)
            : segment.text,
        ),
      ),
    );
  }

  function markActive(): void {
    for (const [index, option] of [...list.children].entries()) {
      option.setAttribute('aria-selected', String(index === active));
    }
    if (active < 0) {
      input.removeAttribute('aria-activedescendant');
    } else {
      input.setAttribute('aria-activedescendant', optionId(active));
      list.children[active]?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function move(step: number): void {
    if (results.length === 0) {
      return;
    }
    active = (active + step + results.length) % results.length;
    markActive();
  }

  function pick(index: number): void {
    const result = results[index];
    if (result !== undefined) {
      options.onPick({ owner: result.repo.owner, name: result.repo.name });
    }
  }

  input.addEventListener('input', search);
  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Enter':
        pick(active);
        break;
      case 'Escape':
        options.onCancel();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  setStatus('Loading repositories...');
  options.loadRepos().then(
    (repos) => {
      searcher = createRepoSearcher(repos, { now: options.now });
      search();
    },
    () => setStatus('Could not load your repositories.'),
  );

  return { root, input };
}
