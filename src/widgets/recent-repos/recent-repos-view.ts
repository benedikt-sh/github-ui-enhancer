import type { DataResult, RecentRepositoryOptions } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RecentRepoItem } from '../../shared/types.ts';
import type { Dispose, WidgetContext } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';
import { itemList } from '../../ui/row.ts';
import { emptyState, errorState, loadingState } from '../../ui/states.ts';
import { relativeTime } from '../../ui/time.ts';
import { activityKinds } from './recent-repos-config.ts';
import type { RecentReposConfig } from './recent-repos-config.ts';
import { recentRepoRow } from './recent-repos-row.ts';

export type Clock = () => Date;

interface ListView {
  readonly items: readonly RecentRepoItem[];
  readonly errors: readonly ApiErrorInfo[];
  /** Fetch time of the shown data if it is outdated, null while it is fresh. */
  readonly staleFetchedAt: string | null;
  /** The last request was rejected, `items` are left over from an earlier one. */
  readonly failed: boolean;
}

type Outcome =
  | { readonly result: DataResult<RecentRepoItem[]> }
  | { readonly error: ApiErrorInfo };

function resultView(result: DataResult<RecentRepoItem[]>): ListView {
  return {
    items: result.data,
    errors: result.errors,
    staleFetchedAt: result.stale ? result.fetchedAt : null,
    failed: false,
  };
}

/** Keeps showing the earlier list, if any, instead of replacing it with an error. */
function failedView(error: ApiErrorInfo, last: DataResult<RecentRepoItem[]> | null): ListView {
  return {
    items: last?.data ?? [],
    errors: [error],
    staleFetchedAt: last?.fetchedAt ?? null,
    failed: true,
  };
}

interface RenderOptions {
  readonly config: RecentReposConfig;
  readonly now: Date;
  readonly openSettings: () => void;
  readonly retry: () => void;
}

function staleFooter(fetchedAt: string, now: Date): HTMLDivElement {
  return h(
    'div',
    { className: 'ghx-recent-repos__footer' },
    h(
      'span',
      {
        className: 'ghx-recent-repos__stale',
        title: 'Refreshing failed or is still running, the list may be outdated.',
      },
      icon('clock'),
      'Updated ',
      relativeTime(fetchedAt, now),
    ),
  );
}

function errorBlock(view: ListView, options: RenderOptions, title: string): HTMLDivElement {
  return errorState(view.errors, {
    title,
    onOpenSettings: options.openSettings,
    onRetry: options.retry,
  });
}

function emptyBlock(config: RecentReposConfig): HTMLDivElement {
  return emptyState({
    icon: 'repo',
    title: 'No recent activity found.',
    description:
      config.activity === 'code'
        ? 'Only pushes, pull requests and created branches count. ' +
          'GitHub keeps your events for up to 90 days.'
        : 'GitHub keeps your events for up to 90 days.',
  });
}

function renderView(view: ListView, options: RenderOptions): Node[] {
  const { config, now } = options;
  const footer = view.staleFetchedAt === null ? null : staleFooter(view.staleFetchedAt, now);
  if (view.items.length === 0) {
    const state =
      view.errors.length > 0
        ? errorBlock(view, options, 'Could not load recent repositories')
        : emptyBlock(config);
    return [state, footer].filter((node) => node !== null);
  }
  const errorTitle = view.failed
    ? 'Could not refresh recent repositories'
    : 'Some activity could not be loaded';
  const rows = view.items.slice(0, config.limit).map((item) => recentRepoRow(item, now));
  return [
    view.errors.length > 0
      ? h('div', { className: 'ghx-recent-repos__errors' }, errorBlock(view, options, errorTitle))
      : null,
    itemList(rows, { label: 'Recent repositories' }),
    footer,
  ].filter((node) => node !== null);
}

function requestOptions(config: RecentReposConfig, forceRefresh: boolean): RecentRepositoryOptions {
  const kinds = activityKinds(config.activity);
  const options = { limit: config.limit, forceRefresh };
  return kinds === undefined ? options : { ...options, kinds };
}

export function mountRecentRepos(
  target: HTMLElement,
  context: WidgetContext<RecentReposConfig>,
  config: RecentReposConfig,
  clock: Clock,
): Dispose {
  const root = h(
    'div',
    { className: 'ghx-recent-repos' },
    loadingState('Loading recent repositories...'),
  );
  target.append(root);
  let disposed = false;
  let latestRequest = 0;
  let lastResult: DataResult<RecentRepoItem[]> | null = null;

  const request = async (forceRefresh: boolean): Promise<Outcome> => {
    try {
      const options = requestOptions(config, forceRefresh);
      return { result: await context.data.recentRepositories(options) };
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
