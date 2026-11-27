import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { RepoSearcher } from '../../lib/fuzzy.ts';
import type { DataResult, WidgetData } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import { sameOwner } from '../../shared/repo.ts';
import type { RepoRef, RepoSummary } from '../../shared/types.ts';
import { appendChildren, h } from '../../ui/dom.ts';
import type { Child } from '../../ui/dom.ts';
import { button, notice, textInput } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import {
  describeApiError,
  emptyState,
  errorState,
  isTokenError,
  loadingState,
} from '../../ui/states.ts';

export const DEFAULT_PICKER_LIMIT = 8;

export interface RepoPickerOptions {
  readonly data: WidgetData;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly selected: RepoRef | null;
  readonly onSelect: (repo: RepoSummary) => void;
  readonly onOpenSettings: () => void;
  readonly limit?: number;
  readonly inputId?: string;
}

export interface RepoPicker {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  setSelected(repo: RepoRef | null): void;
}

function isSameRepo(a: RepoRef | null, b: RepoRef): boolean {
  return a !== null && sameOwner(a.owner, b.owner) && sameOwner(a.name, b.name);
}

function partialErrors(errors: readonly ApiErrorInfo[], onOpenSettings: () => void): Child {
  if (errors.length === 0) {
    return null;
  }
  const settings = errors.some((error) => isTokenError(error.kind))
    ? [button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: onOpenSettings })]
    : [];
  return notice({
    variant: 'warning',
    message: errors.map(describeApiError).join(' '),
    actions: settings,
  });
}

/** Type-to-filter list over the repo index, for choosing the repo of a widget. */
export function repoPicker(options: RepoPickerOptions): RepoPicker {
  const { data, signal, onOpenSettings } = options;
  const limit = options.limit ?? DEFAULT_PICKER_LIMIT;
  let selected = options.selected;
  let searcher: RepoSearcher | null = null;
  let matches: RepoSummary[] = [];
  let request = 0;

  const input = textInput({
    type: 'search',
    placeholder: 'Filter repositories',
    ariaLabel: 'Filter repositories',
    autocomplete: 'off',
    disabled: true,
    ...(options.inputId === undefined ? {} : { id: options.inputId }),
    onInput: () => renderMatches(),
  });
  const notices = h('div', { className: 'ghx-actions-runs-picker__notices' });
  const results = h('div', { className: 'ghx-actions-runs-picker__results' });
  const root = h('div', { className: 'ghx-actions-runs-picker' }, input, notices, results);

  const optionButtons = (): HTMLButtonElement[] => [
    ...results.querySelectorAll<HTMLButtonElement>('.ghx-actions-runs-picker__option'),
  ];

  const moveFocus = (from: number, step: number): void => {
    const buttons = optionButtons();
    const target = from + step;
    if (target < 0) {
      input.focus();
    } else {
      buttons[Math.min(target, buttons.length - 1)]?.focus();
    }
  };

  const optionButton = (repo: RepoSummary, index: number): HTMLLIElement => {
    const current = isSameRepo(selected, repo);
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          className: 'ghx-actions-runs-picker__option',
          'aria-pressed': String(current),
          on: {
            click: () => options.onSelect(repo),
            keydown: (event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(index, event.key === 'ArrowDown' ? 1 : -1);
              }
            },
          },
        },
        icon(current ? 'check' : 'repo'),
        h('span', { className: 'ghx-actions-runs-picker__name' }, repo.fullName),
        repo.description
          ? h('span', { className: 'ghx-actions-runs-picker__description' }, repo.description)
          : null,
      ),
    );
  };

  function renderMatches(): void {
    if (searcher === null) {
      return;
    }
    matches = searcher.search(input.value, { limit }).map((match) => match.repo);
    results.replaceChildren(
      matches.length === 0
        ? h('p', { className: 'ghx-hint' }, 'No matching repositories.')
        : h(
            'ul',
            { className: 'ghx-actions-runs-picker__list', 'aria-label': 'Repositories' },
            matches.map(optionButton),
          ),
    );
  }

  const showIndex = (result: DataResult<RepoSummary[]>): void => {
    notices.replaceChildren();
    if (result.data.length === 0) {
      results.replaceChildren(
        result.errors.length > 0
          ? errorState(result.errors, {
              title: 'Could not load repositories',
              onOpenSettings,
              onRetry: () => load(true),
            })
          : emptyState({
              icon: 'repo',
              title: 'No repositories',
              description: 'Add an access token to see your repositories.',
              actions: [button({ label: 'Open settings', icon: 'gear', onClick: onOpenSettings })],
            }),
      );
      return;
    }
    appendChildren(notices, [partialErrors(result.errors, onOpenSettings)]);
    searcher = createRepoSearcher(result.data, { now: options.now });
    input.disabled = false;
    renderMatches();
  };

  function load(forceRefresh: boolean): void {
    request += 1;
    const current = request;
    const live = (): boolean => current === request && !signal.aborted;
    results.replaceChildren(loadingState('Loading repositories...'));
    data.repoIndex({ forceRefresh }).then(
      (result) => {
        if (live()) {
          showIndex(result);
        }
      },
      (error: unknown) => {
        if (live()) {
          results.replaceChildren(
            errorState([toApiErrorInfo(error)], {
              title: 'Could not load repositories',
              onOpenSettings,
              onRetry: () => load(true),
            }),
          );
        }
      },
    );
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      // Inside the config form Enter would otherwise submit it.
      event.preventDefault();
      const first = matches[0];
      if (first) {
        options.onSelect(first);
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(-1, 1);
    }
  });

  load(false);

  return {
    root,
    input,
    setSelected(repo) {
      selected = repo;
      renderMatches();
    },
  };
}
