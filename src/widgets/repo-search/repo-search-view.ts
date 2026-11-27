import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { RepoSearcher, RepoSearchResult } from '../../lib/fuzzy.ts';
import type { DataResult } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RepoSummary } from '../../shared/types.ts';
import type { Dispose, WidgetContext } from '../../shared/widget.ts';
import { appendChildren, h, uniqueId } from '../../ui/dom.ts';
import { button, checkbox, iconButton, select, textInput } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import { emptyState, errorState, loadingState } from '../../ui/states.ts';
import { formatRelativeTime } from '../../ui/time.ts';
import type { OpenUrl } from './open-url.ts';
import { collectOwners } from './owners.ts';
import type { RepoSearchConfig } from './repo-search-config.ts';
import { repoHref, resultOption } from './result-option.ts';

export const MAX_RESULTS = 10;

export interface RepoSearchViewOptions {
  readonly now: () => number;
  readonly openUrl: OpenUrl;
}

interface LoadedIndex {
  readonly repos: readonly RepoSummary[];
  readonly searcher: RepoSearcher;
  readonly errors: readonly ApiErrorInfo[];
  readonly fetchedAt: string;
  readonly stale: boolean;
}

const numberFormat = new Intl.NumberFormat('en-US');

function repoCount(count: number): string {
  return `${numberFormat.format(count)} ${count === 1 ? 'repository' : 'repositories'}`;
}

export function mountRepoSearch(
  target: HTMLElement,
  context: WidgetContext<RepoSearchConfig>,
  initialConfig: RepoSearchConfig,
  options: RepoSearchViewOptions,
): Dispose {
  const { now, openUrl } = options;
  let config = initialConfig;
  let index: LoadedIndex | null = null;
  let loadError: ApiErrorInfo | null = null;
  let loading = false;
  let requestSeq = 0;
  let results: RepoSearchResult[] = [];
  let activeIndex = -1;
  let ownerKey = '';
  let disposed = false;

  const listId = uniqueId('ghx-repo-search-list');
  const optionId = (position: number): string => `${listId}-option-${position}`;
  const openSettings = (): void => context.openOptions();

  const input = textInput({
    type: 'search',
    ariaLabel: 'Search repositories',
    placeholder: 'Search repositories across all your organizations',
    autocomplete: 'off',
    className: 'ghx-repo-search__input',
    onInput: () => {
      runSearch(false);
      renderResults();
    },
  });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('keydown', onKeyDown);

  const ownerSelect = select({
    options: [],
    ariaLabel: 'Filter by owner',
    className: 'ghx-repo-search__owner-filter',
    onChange: (value) => updateConfig({ ...config, owner: value === '' ? null : value }),
  });
  const archived = checkbox({
    label: 'Include archived',
    checked: config.includeArchived,
    onChange: (checked) => updateConfig({ ...config, includeArchived: checked }),
  });
  const list = h('ul', {
    className: 'ghx-repo-search__list',
    id: listId,
    role: 'listbox',
    'aria-label': 'Repositories',
  });
  const resultState = h('div', { className: 'ghx-repo-search__state' });
  const notices = h('div', { className: 'ghx-repo-search__notices' });
  const status = h('div', { className: 'ghx-repo-search__status', hidden: true });

  const root = h(
    'div',
    { className: 'ghx-repo-search', role: 'search', 'aria-label': 'Repository search' },
    h(
      'div',
      { className: 'ghx-repo-search__bar' },
      h(
        'div',
        { className: 'ghx-repo-search__field' },
        icon('search', { className: 'ghx-repo-search__field-icon' }),
        input,
      ),
      h('div', { className: 'ghx-repo-search__filters' }, ownerSelect, archived.root),
    ),
    status,
    notices,
    h('div', { className: 'ghx-repo-search__results' }, list, resultState),
  );
  target.append(root);

  const offRefresh = context.onRefresh((reason) => load(reason === 'manual'));
  renderOwners();
  load(false);

  function isCurrent(seq: number): boolean {
    return !disposed && !context.signal.aborted && seq === requestSeq;
  }

  function load(forceRefresh: boolean): void {
    requestSeq += 1;
    const seq = requestSeq;
    loading = true;
    render();
    new Promise<DataResult<RepoSummary[]>>((resolve) => {
      resolve(forceRefresh ? context.data.repoIndex({ forceRefresh }) : context.data.repoIndex());
    }).then(
      (result) => {
        if (isCurrent(seq)) {
          applyResult(result);
        }
      },
      (error: unknown) => {
        if (isCurrent(seq)) {
          loading = false;
          loadError = toApiErrorInfo(error);
          render();
        }
      },
    );
  }

  function applyResult(result: DataResult<RepoSummary[]>): void {
    const searcher =
      index !== null && index.repos === result.data
        ? index.searcher
        : createRepoSearcher(result.data, { now });
    index = {
      repos: result.data,
      searcher,
      errors: result.errors,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };
    loading = false;
    loadError = null;
    runSearch(true);
    render();
  }

  function runSearch(keepSelection: boolean): void {
    const activeId = results[activeIndex]?.repo.id;
    results =
      index?.searcher.search(input.value, {
        owner: config.owner ?? undefined,
        includeArchived: config.includeArchived,
        limit: MAX_RESULTS,
      }) ?? [];
    const kept = keepSelection ? results.findIndex((result) => result.repo.id === activeId) : -1;
    activeIndex = kept !== -1 ? kept : results.length > 0 ? 0 : -1;
  }

  function updateConfig(next: RepoSearchConfig): void {
    config = next;
    // A failed save keeps the filter for this page view, there is nothing better to do here.
    context.saveConfig(config).catch(() => undefined);
    runSearch(false);
    renderResults();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        moveActive(1);
        break;
      case 'ArrowUp':
        moveActive(-1);
        break;
      case 'Enter':
        openActive(event.ctrlKey || event.metaKey);
        break;
      case 'Escape':
        if (input.value === '') {
          return;
        }
        input.value = '';
        runSearch(false);
        renderResults();
        break;
      default:
        return;
    }
    // Keeps GitHub's own handlers from reacting to keys the search has consumed.
    event.preventDefault();
    event.stopPropagation();
  }

  function moveActive(step: number): void {
    if (results.length === 0) {
      return;
    }
    activeIndex = (activeIndex + step + results.length) % results.length;
    list.querySelectorAll('[role="option"]').forEach((option, position) => {
      option.setAttribute('aria-selected', String(position === activeIndex));
    });
    input.setAttribute('aria-activedescendant', optionId(activeIndex));
  }

  function openActive(newTab: boolean): void {
    const result = results[activeIndex];
    if (result !== undefined) {
      openUrl(repoHref(result.repo), newTab);
    }
  }

  function render(): void {
    renderOwners();
    renderStatus();
    renderNotices();
    renderResults();
  }

  function renderOwners(): void {
    const owners = collectOwners(index?.repos ?? [], config.owner);
    const key = owners.join('\n');
    if (key !== ownerKey || ownerSelect.options.length === 0) {
      ownerKey = key;
      ownerSelect.replaceChildren(
        h('option', { value: '' }, 'All owners'),
        ...owners.map((owner) => h('option', { value: owner }, owner)),
      );
    }
    ownerSelect.value = config.owner ?? '';
  }

  function renderStatus(): void {
    status.hidden = index === null;
    if (index === null) {
      status.replaceChildren();
      return;
    }
    const age = formatRelativeTime(index.fetchedAt, now());
    status.replaceChildren();
    appendChildren(status, [
      h('span', { className: 'ghx-repo-search__count' }, repoCount(index.repos.length)),
      age === '' ? null : h('span', { className: 'ghx-repo-search__age' }, `Updated ${age}`),
      index.stale
        ? h(
            'span',
            {
              className: 'ghx-repo-search__stale',
              title: 'The last refresh of the repository list did not finish.',
            },
            'Outdated',
          )
        : null,
      iconButton({
        icon: 'sync',
        label: 'Reload repositories',
        size: 'small',
        disabled: loading,
        className: ['ghx-repo-search__reload', loading && 'ghx-repo-search__reload--busy'],
        onClick: () => load(true),
      }),
    ]);
  }

  function renderNotices(): void {
    const children: HTMLElement[] = [];
    if (index !== null && index.repos.length > 0 && index.errors.length > 0) {
      children.push(
        errorState(index.errors, {
          title: 'Some repositories could not be loaded',
          onOpenSettings: openSettings,
        }),
      );
    }
    if (index !== null && loadError !== null) {
      children.push(
        errorState([loadError], {
          title: 'Could not refresh repositories',
          onOpenSettings: openSettings,
          onRetry: () => load(true),
        }),
      );
    }
    notices.replaceChildren(...children);
  }

  function renderResults(): void {
    list.replaceChildren(
      ...results.map((result, position) =>
        resultOption({
          result,
          id: optionId(position),
          active: position === activeIndex,
          now: now(),
        }),
      ),
    );
    input.setAttribute('aria-expanded', String(results.length > 0));
    if (activeIndex === -1) {
      input.removeAttribute('aria-activedescendant');
    } else {
      input.setAttribute('aria-activedescendant', optionId(activeIndex));
    }
    const state = resultStateElement();
    resultState.replaceChildren(...(state === null ? [] : [state]));
  }

  function noTokensState(): HTMLElement {
    return emptyState({
      icon: 'gear',
      title: 'No access token configured',
      description:
        'Add a fine-grained token per account or organization to search their repositories.',
      actions: [
        button({ label: 'Open settings', size: 'small', onClick: openSettings }),
      ],
    });
  }

  function resultStateElement(): HTMLElement | null {
    if (index === null) {
      if (loadError === null) {
        return loadingState('Loading repositories...');
      }
      return loadError.kind === 'no_tokens'
        ? noTokensState()
        : errorState([loadError], {
            title: 'Could not load repositories',
            onOpenSettings: openSettings,
            onRetry: () => load(true),
          });
    }
    if (index.repos.length === 0) {
      if (index.errors.some((error) => error.kind === 'no_tokens')) {
        return noTokensState();
      }
      if (index.errors.length > 0) {
        return errorState(index.errors, {
          title: 'Could not load repositories',
          onOpenSettings: openSettings,
          onRetry: () => load(true),
        });
      }
      return emptyState({
        icon: 'repo',
        title: 'No repositories found',
        description: 'Your tokens do not grant access to any repository.',
      });
    }
    if (results.length > 0) {
      return null;
    }
    const query = input.value.trim();
    return emptyState({
      icon: 'search',
      title:
        query === '' ? 'No repositories match the filters' : `No repositories match "${query}"`,
      description:
        config.owner !== null || !config.includeArchived
          ? 'Try another owner or include archived repositories.'
          : undefined,
    });
  }

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    offRefresh();
    root.remove();
  };
}
