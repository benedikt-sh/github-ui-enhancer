import type { DataResult } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { PullRequestItem } from '../../shared/types.ts';
import type { Dispose, WidgetContext } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';
import { pullRequestRow } from '../../ui/pull-request-row.ts';
import { itemList, link } from '../../ui/row.ts';
import { emptyState, errorState, loadingState } from '../../ui/states.ts';
import { relativeTime } from '../../ui/time.ts';
import { pullRequestSearchUrl } from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';

export type Clock = () => Date;

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

interface RenderOptions {
  readonly config: PullRequestListConfig;
  readonly now: Date;
  readonly openSettings: () => void;
  readonly retry: () => void;
}

function staleMarker(fetchedAt: string, now: Date): HTMLSpanElement {
  return h(
    'span',
    {
      className: 'ghx-pr-list__stale',
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
    { className: 'ghx-pr-list__footer' },
    view.staleFetchedAt === null ? null : staleMarker(view.staleFetchedAt, options.now),
    link('View all on GitHub', pullRequestSearchUrl(options.config.query), [
      'ghx-link',
      'ghx-pr-list__all',
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

function renderView(view: ListView, options: RenderOptions): Node[] {
  const { config, now } = options;
  if (view.items.length === 0) {
    const state =
      view.errors.length > 0
        ? errorBlock(view, options, 'Could not load pull requests')
        : emptyState({
            icon: 'git-pull-request',
            title: 'No pull requests match',
            description: ['Search: ', h('code', null, config.query)],
          });
    return [state, footer(view, options)];
  }
  const errorTitle = view.failed
    ? 'Could not refresh pull requests'
    : 'Some pull requests could not be loaded';
  const rows = view.items
    .slice(0, config.limit)
    .map((pr) => pullRequestRow(pr, { now, showRepo: config.showRepo }));
  return [
    view.errors.length > 0
      ? h('div', { className: 'ghx-pr-list__errors' }, errorBlock(view, options, errorTitle))
      : null,
    itemList(rows, { label: 'Pull requests' }),
    footer(view, options),
  ].filter((node) => node !== null);
}

export function mountPullRequestList(
  target: HTMLElement,
  context: WidgetContext<PullRequestListConfig>,
  config: PullRequestListConfig,
  clock: Clock,
): Dispose {
  const root = h('div', { className: 'ghx-pr-list' }, loadingState('Loading pull requests...'));
  target.append(root);
  let disposed = false;
  let latestRequest = 0;
  let lastResult: DataResult<PullRequestItem[]> | null = null;

  const request = async (forceRefresh: boolean): Promise<Outcome> => {
    try {
      const options = { limit: config.limit, forceRefresh };
      return { result: await context.data.searchPullRequests(config.query, options) };
    } catch (error) {
      return { error: toApiErrorInfo(error) };
    }
  };

  const load = async (forceRefresh: boolean): Promise<void> => {
    latestRequest += 1;
    const current = latestRequest;
    root.setAttribute('aria-busy', 'true');
    const outcome = await request(forceRefresh);
    if (disposed || context.signal.aborted || current !== latestRequest) {
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
    root.replaceChildren(
      ...renderView(view, {
        config,
        now: clock(),
        openSettings: () => context.openOptions(),
        retry: () => void load(true),
      }),
    );
  };

  const unsubscribe = context.onRefresh((reason) => void load(reason === 'manual'));
  void load(false);

  return () => {
    disposed = true;
    unsubscribe();
    root.remove();
  };
}
