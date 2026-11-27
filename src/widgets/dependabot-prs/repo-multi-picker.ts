import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { RepoSearcher } from '../../lib/fuzzy.ts';
import type { DataResult, WidgetData } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import { repoFullName } from '../../shared/repo.ts';
import type { RepoRef, RepoSummary } from '../../shared/types.ts';
import { appendChildren, h } from '../../ui/dom.ts';
import { button, iconButton, notice, textInput } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import {
  describeApiError,
  emptyState,
  errorState,
  isTokenError,
  loadingState,
  uniqueErrors,
} from '../../ui/states.ts';
import { MAX_REPOS, sameRepo } from './dependabot-prs-config.ts';

export const DEFAULT_RESULT_LIMIT = 8;

export interface RepoMultiPickerOptions {
  readonly data: WidgetData;
  readonly signal: AbortSignal;
  /** Epoch milliseconds, for the recency ranking of the repo search. */
  readonly now: () => number;
  readonly selected: readonly RepoRef[];
  readonly onChange: (repos: readonly RepoRef[]) => void;
  /** Null where the settings cannot be opened, e.g. in the config form. */
  readonly onOpenSettings: (() => void) | null;
  readonly max?: number;
  /** Number of matches shown at once. */
  readonly resultLimit?: number;
  readonly inputId?: string;
}

export interface RepoMultiPicker {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  selected(): RepoRef[];
}

function partialErrorNotice(
  errors: readonly ApiErrorInfo[],
  onOpenSettings: (() => void) | null,
): HTMLDivElement | null {
  if (errors.length === 0) {
    return null;
  }
  const showSettings = onOpenSettings && errors.some((error) => isTokenError(error.kind));
  return notice({
    variant: 'warning',
    message: uniqueErrors(errors).map(describeApiError).join(' '),
    actions: showSettings
      ? [button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: onOpenSettings })]
      : [],
  });
}

/** Type-to-filter list over the repo index that collects several repositories. */
export function repoMultiPicker(options: RepoMultiPickerOptions): RepoMultiPicker {
  const { data, signal, onOpenSettings } = options;
  const settingsOption = onOpenSettings ? { onOpenSettings } : {};
  const max = options.max ?? MAX_REPOS;
  const resultLimit = options.resultLimit ?? DEFAULT_RESULT_LIMIT;
  let selected: RepoRef[] = [...options.selected];
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
  const chips = h('div', { className: 'ghx-dependabot-picker__selection' });
  const notices = h('div', { className: 'ghx-dependabot-picker__notices' });
  const results = h('div', { className: 'ghx-dependabot-picker__results' });
  const root = h('div', { className: 'ghx-dependabot-picker' }, chips, input, notices, results);

  const isSelected = (repo: RepoRef): boolean => selected.some((entry) => sameRepo(entry, repo));
  const isFull = (): boolean => selected.length >= max;

  const update = (next: RepoRef[]): void => {
    selected = next;
    renderChips();
    renderMatches();
    options.onChange([...selected]);
  };

  const add = (repo: RepoRef): void => {
    if (!isSelected(repo) && !isFull()) {
      update([...selected, { owner: repo.owner, name: repo.name }]);
    }
  };

  const remove = (repo: RepoRef): void => {
    update(selected.filter((entry) => !sameRepo(entry, repo)));
  };

  function renderChips(): void {
    if (selected.length === 0) {
      chips.replaceChildren(h('p', { className: 'ghx-hint' }, 'No repositories selected.'));
      return;
    }
    chips.replaceChildren();
    appendChildren(chips, [
      h(
        'ul',
        { className: 'ghx-dependabot-picker__chips', 'aria-label': 'Selected repositories' },
        selected.map((repo) =>
          h(
            'li',
            { className: 'ghx-dependabot-picker__chip' },
            icon('repo'),
            h('span', { className: 'ghx-dependabot-picker__chip-name' }, repoFullName(repo)),
            iconButton({
              icon: 'x',
              label: `Remove ${repoFullName(repo)}`,
              size: 'small',
              onClick: () => {
                remove(repo);
                input.focus();
              },
            }),
          ),
        ),
      ),
      isFull()
        ? h('p', { className: 'ghx-hint' }, `You can select up to ${max} repositories.`)
        : null,
    ]);
  }

  const optionButtons = (): HTMLButtonElement[] => [
    ...results.querySelectorAll<HTMLButtonElement>('.ghx-dependabot-picker__option'),
  ];

  const moveFocus = (from: number, step: number): void => {
    const target = from + step;
    if (target < 0) {
      input.focus();
      return;
    }
    const buttons = optionButtons();
    buttons[Math.min(target, buttons.length - 1)]?.focus();
  };

  const optionButton = (repo: RepoSummary, index: number): HTMLLIElement => {
    const current = isSelected(repo);
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          className: 'ghx-dependabot-picker__option',
          'aria-pressed': String(current),
          disabled: !current && isFull(),
          on: {
            click: () => (current ? remove(repo) : add(repo)),
            keydown: (event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(index, event.key === 'ArrowDown' ? 1 : -1);
              }
            },
          },
        },
        icon(current ? 'check' : 'repo'),
        h('span', { className: 'ghx-dependabot-picker__name' }, repo.fullName),
        repo.description
          ? h('span', { className: 'ghx-dependabot-picker__description' }, repo.description)
          : null,
      ),
    );
  };

  function renderMatches(): void {
    if (searcher === null) {
      return;
    }
    // Keeps the focused option focused across the re-render after a click.
    const focused = optionButtons().findIndex((option) => option === document.activeElement);
    matches = searcher.search(input.value, { limit: resultLimit }).map((match) => match.repo);
    results.replaceChildren(
      matches.length === 0
        ? h('p', { className: 'ghx-hint' }, 'No matching repositories.')
        : h(
            'ul',
            { className: 'ghx-dependabot-picker__list', 'aria-label': 'Repositories' },
            matches.map(optionButton),
          ),
    );
    if (focused >= 0) {
      optionButtons()[focused]?.focus();
    }
  }

  const failed = (errors: readonly ApiErrorInfo[]): HTMLDivElement =>
    errorState(errors, {
      title: 'Could not load repositories',
      ...settingsOption,
      onRetry: () => load(true),
    });

  const showIndex = (result: DataResult<RepoSummary[]>): void => {
    if (result.data.length === 0) {
      results.replaceChildren(
        result.errors.length > 0
          ? failed(result.errors)
          : emptyState({
              icon: 'repo',
              title: 'No repositories',
              description: 'Add an access token to see your repositories.',
              actions: onOpenSettings
                ? [button({ label: 'Open settings', icon: 'gear', onClick: onOpenSettings })]
                : [],
            }),
      );
      return;
    }
    const warning = partialErrorNotice(result.errors, onOpenSettings);
    if (warning) {
      notices.replaceChildren(warning);
    }
    searcher = createRepoSearcher(result.data, { now: options.now });
    input.disabled = false;
    renderMatches();
  };

  function load(forceRefresh: boolean): void {
    request += 1;
    const current = request;
    const live = (): boolean => current === request && !signal.aborted;
    notices.replaceChildren();
    results.replaceChildren(loadingState('Loading repositories...'));
    data.repoIndex({ forceRefresh }).then(
      (result) => {
        if (live()) {
          showIndex(result);
        }
      },
      (error: unknown) => {
        if (live()) {
          results.replaceChildren(failed([toApiErrorInfo(error)]));
        }
      },
    );
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      // Inside a form Enter would otherwise submit it.
      event.preventDefault();
      const first = matches.find((repo) => !isSelected(repo));
      if (first) {
        add(first);
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(-1, 1);
    }
  });

  renderChips();
  load(false);

  return { root, input, selected: () => [...selected] };
}
