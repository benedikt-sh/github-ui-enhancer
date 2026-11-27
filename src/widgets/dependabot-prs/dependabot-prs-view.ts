import type { DataResult } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import { repoFullName } from '../../shared/repo.ts';
import type { PullRequestItem, RepoRef } from '../../shared/types.ts';
import type { Dispose, WidgetContext } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { button, notice } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import { pullRequestRow } from '../../ui/pull-request-row.ts';
import { itemList, link, repoLink } from '../../ui/row.ts';
import { emptyState, errorState, loadingState } from '../../ui/states.ts';
import { relativeTime } from '../../ui/time.ts';
import { repoKey } from './dependabot-prs-config.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';
import { dependabotSearchUrl, searchDependabotPullRequests } from './dependabot-prs-search.ts';
import { repoMultiPicker } from './repo-multi-picker.ts';

export type Clock = () => Date;

export const EMPTY_TITLE = 'No open Dependabot pull requests in the selected repositories';

interface ListView {
  readonly items: readonly PullRequestItem[];
  readonly errors: readonly ApiErrorInfo[];
  /** Fetch time of the shown data if it is outdated, null while it is fresh. */
  readonly staleFetchedAt: string | null;
  /** The last request was rejected, `items` are left over from an earlier one. */
  readonly failed: boolean;
}

type Outcome =
  | { readonly result: DataResult<PullRequestItem[]> }
  | { readonly error: ApiErrorInfo };

function resultView(result: DataResult<PullRequestItem[]>): ListView {
  return {
    items: result.data,
    errors: result.errors,
    staleFetchedAt: result.stale ? result.fetchedAt : null,
    failed: false,
  };
}

/** Keeps showing the earlier list, if any, instead of replacing it with an error. */
function failedView(error: ApiErrorInfo, last: DataResult<PullRequestItem[]> | null): ListView {
  return {
    items: last?.data ?? [],
    errors: [error],
    staleFetchedAt: last?.fetchedAt ?? null,
    failed: true,
  };
}

export interface RepoGroup {
  readonly repo: RepoRef;
  readonly items: readonly PullRequestItem[];
}

/** Groups in the order of their newest pull request, as `items` are sorted newest first. */
export function groupByRepo(items: readonly PullRequestItem[]): RepoGroup[] {
  const groups = new Map<string, { repo: RepoRef; items: PullRequestItem[] }>();
  for (const item of items) {
    const key = repoKey(item.repo);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { repo: item.repo, items: [item] });
    }
  }
  return [...groups.values()];
}

interface RenderOptions {
  readonly config: DependabotPrsConfig;
  readonly now: Date;
  readonly openSettings: () => void;
  readonly retry: () => void;
}

function staleMarker(fetchedAt: string, now: Date): HTMLSpanElement {
  return h(
    'span',
    {
      className: 'ghx-dependabot-prs__stale',
      title: 'Refreshing failed or is still running, the list may be outdated.',
    },
    icon('clock'),
    'Updated ',
    relativeTime(fetchedAt, now),
  );
}

function footer(view: ListView, options: RenderOptions): HTMLDivElement {
  return h(
    'div',
    { className: 'ghx-dependabot-prs__footer' },
    view.staleFetchedAt === null ? null : staleMarker(view.staleFetchedAt, options.now),
    link('View on GitHub', dependabotSearchUrl(options.config.repos), [
      'ghx-link',
      'ghx-dependabot-prs__all',
    ]),
  );
}

function errorBlock(view: ListView, options: RenderOptions, title: string): HTMLDivElement {
  return errorState(view.errors, {
    title,
    onOpenSettings: options.openSettings,
    onRetry: options.retry,
  });
}

function pullRequestCount(count: number): string {
  return `${count} pull request${count === 1 ? '' : 's'}`;
}

function groupedList(items: readonly PullRequestItem[], now: Date): HTMLDivElement {
  return h(
    'div',
    { className: 'ghx-dependabot-prs__groups' },
    groupByRepo(items).map((group) =>
      h(
        'section',
        { className: 'ghx-dependabot-prs__group' },
        h(
          'h3',
          { className: 'ghx-dependabot-prs__group-header' },
          repoLink(group.repo),
          h(
            'span',
            {
              className: 'ghx-counter',
              title: pullRequestCount(group.items.length),
              'aria-label': pullRequestCount(group.items.length),
            },
            group.items.length,
          ),
        ),
        itemList(
          group.items.map((pr) => pullRequestRow(pr, { now, showRepo: false })),
          { label: `Pull requests in ${repoFullName(group.repo)}` },
        ),
      ),
    ),
  );
}

function renderView(view: ListView, options: RenderOptions): Node[] {
  const { config, now } = options;
  if (view.items.length === 0) {
    const state =
      view.errors.length > 0
        ? errorBlock(view, options, 'Could not load Dependabot pull requests')
        : emptyState({ icon: 'git-pull-request', title: EMPTY_TITLE });
    return [state, footer(view, options)];
  }
  const errorTitle = view.failed
    ? 'Could not refresh pull requests'
    : 'Some pull requests could not be loaded';
  const items = view.items.slice(0, config.limit);
  const list = config.groupByRepo
    ? groupedList(items, now)
    : itemList(
        items.map((pr) => pullRequestRow(pr, { now, showRepo: true })),
        { label: 'Dependabot pull requests' },
      );
  return [
    view.errors.length > 0
      ? h('div', { className: 'ghx-dependabot-prs__errors' }, errorBlock(view, options, errorTitle))
      : null,
    list,
    footer(view, options),
  ].filter((node) => node !== null);
}

export function mountDependabotPrs(
  target: HTMLElement,
  context: WidgetContext<DependabotPrsConfig>,
  initialConfig: DependabotPrsConfig,
  clock: Clock,
): Dispose {
  let config = initialConfig;
  let disposed = false;
  let latestRequest = 0;
  let lastResult: DataResult<PullRequestItem[]> | null = null;

  const status = h('div', { className: 'ghx-dependabot-prs__status' });
  const main = h('div', { className: 'ghx-dependabot-prs__main' });
  const root = h('div', { className: 'ghx-dependabot-prs' }, status, main);
  target.append(root);

  const live = (): boolean => !disposed && !context.signal.aborted;
  const openSettings = (): void => context.openOptions();

  const request = async (forceRefresh: boolean): Promise<Outcome> => {
    try {
      const options = { limit: config.limit, forceRefresh, now: clock };
      return { result: await searchDependabotPullRequests(context.data, config.repos, options) };
    } catch (error) {
      return { error: toApiErrorInfo(error) };
    }
  };

  const load = async (forceRefresh: boolean): Promise<void> => {
    latestRequest += 1;
    const current = latestRequest;
    root.setAttribute('aria-busy', 'true');
    const outcome = await request(forceRefresh);
    if (!live() || current !== latestRequest) {
      return;
    }
    let view: ListView;
    if ('result' in outcome) {
      lastResult = outcome.result;
      view = resultView(outcome.result);
    } else {
      view = failedView(outcome.error, lastResult);
    }
    root.removeAttribute('aria-busy');
    main.replaceChildren(
      ...renderView(view, {
        config,
        now: clock(),
        openSettings,
        retry: () => void load(true),
      }),
    );
  };

  const save = (repos: readonly RepoRef[]): void => {
    config = { ...config, repos: [...repos] };
    context.saveConfig(config).catch(() => {
      if (live()) {
        status.replaceChildren(
          notice({
            variant: 'warning',
            message: 'The repositories could not be saved and are only used until reload.',
          }),
        );
      }
    });
    main.replaceChildren(loadingState('Loading pull requests...'));
    void load(false);
  };

  const renderSetup = (): void => {
    let chosen: readonly RepoRef[] = [];
    const show = button({
      label: 'Show pull requests',
      variant: 'primary',
      disabled: true,
      onClick: () => save(chosen),
    });
    const picker = repoMultiPicker({
      data: context.data,
      signal: context.signal,
      now: () => clock().getTime(),
      selected: [],
      onOpenSettings: openSettings,
      onChange: (repos) => {
        chosen = repos;
        show.disabled = repos.length === 0;
      },
    });
    main.replaceChildren(
      h(
        'div',
        { className: 'ghx-dependabot-prs__setup' },
        h(
          'p',
          { className: 'ghx-dependabot-prs__intro' },
          'Choose the repositories whose open Dependabot pull requests this widget shows.',
        ),
        picker.root,
        h('div', { className: 'ghx-dependabot-prs__setup-actions' }, show),
      ),
    );
  };

  const unsubscribe = context.onRefresh((reason) => {
    if (config.repos.length > 0) {
      void load(reason === 'manual');
    }
  });

  if (config.repos.length === 0) {
    renderSetup();
  } else {
    main.replaceChildren(loadingState('Loading pull requests...'));
    void load(false);
  }

  return () => {
    disposed = true;
    unsubscribe();
    root.remove();
  };
}
