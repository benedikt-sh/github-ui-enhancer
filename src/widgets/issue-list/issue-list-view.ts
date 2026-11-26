import type { DataResult, ListOptions } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { IssueItem } from '../../shared/types.ts';
import type { Dispose, RefreshReason, WidgetContext } from '../../shared/widget.ts';
import { appendChildren, h } from '../../ui/dom.ts';
import { issueRow } from '../../ui/issue-row.ts';
import { icon } from '../../ui/octicons.ts';
import { itemList, link } from '../../ui/row.ts';
import { emptyState, errorState, loadingState } from '../../ui/states.ts';
import { relativeTime } from '../../ui/time.ts';
import { issueListTitle, viewAllUrl } from './config.ts';
import type { IssueListConfig } from './config.ts';

export interface IssueListDeps {
  now(): number;
}

type IssueResult = DataResult<IssueItem[]>;

function fetchIssues(
  context: WidgetContext<IssueListConfig>,
  config: IssueListConfig,
  forceRefresh: boolean,
): Promise<IssueResult> {
  const options: ListOptions = { limit: config.limit, forceRefresh };
  return config.source === 'search'
    ? context.data.searchIssues(config.query, options)
    : context.data.subscribedIssues(options);
}

function emptyMessage(config: IssueListConfig): HTMLDivElement {
  return config.source === 'search'
    ? emptyState({
        icon: 'issue-opened',
        title: 'No issues found',
        description: 'No issues match this query.',
      })
    : emptyState({
        icon: 'eye',
        title: 'No watched issues',
        description: 'You are not subscribed to any open issues.',
      });
}

function staleMarker(fetchedAt: string, now: number): HTMLSpanElement {
  return h(
    'span',
    { className: 'ghx-issue-list__stale', title: 'Refreshing failed or is still running' },
    icon('clock'),
    'Outdated, fetched ',
    relativeTime(fetchedAt, now),
  );
}

/**
 * Renders the issue list into its own root inside `target`. Refreshes keep the previous
 * content until the new result arrives, so the list does not flicker.
 */
export function mountIssueList(
  target: HTMLElement,
  context: WidgetContext<IssueListConfig>,
  config: IssueListConfig,
  deps: IssueListDeps,
): Dispose {
  const root = h('div', { className: 'ghx-issue-list' }, loadingState('Loading issues...'));
  target.append(root);
  let lastResult: IssueResult | null = null;
  let generation = 0;
  let disposed = false;

  const retry = (): void => load(true);
  const openSettings = (): void => context.openOptions();

  function footer(result: IssueResult, failed: boolean): HTMLElement {
    return h(
      'footer',
      { className: 'ghx-issue-list__footer' },
      result.stale || failed ? staleMarker(result.fetchedAt, deps.now()) : null,
      link('View all on GitHub', viewAllUrl(config), 'ghx-link ghx-issue-list__view-all'),
    );
  }

  function failureState(errors: readonly ApiErrorInfo[]): HTMLDivElement {
    return errorState(errors, {
      title: 'Could not load issues',
      onOpenSettings: openSettings,
      onRetry: retry,
    });
  }

  /** `failure` is set when a refresh was rejected and `result` is the previous one. */
  function render(result: IssueResult, failure: ApiErrorInfo | null): void {
    const errors = failure === null ? result.errors : [failure, ...result.errors];
    const issues = result.data.slice(0, config.limit);
    if (issues.length === 0 && errors.length > 0) {
      root.replaceChildren(failureState(errors), footer(result, failure !== null));
      return;
    }
    const now = deps.now();
    root.replaceChildren();
    appendChildren(root, [
      errors.length > 0
        ? h(
            'div',
            { className: 'ghx-issue-list__errors' },
            errorState(errors, {
              title: 'Some issues could not be loaded',
              onOpenSettings: openSettings,
              onRetry: retry,
            }),
          )
        : null,
      issues.length > 0
        ? itemList(
            issues.map((issue) => issueRow(issue, { now, showRepo: config.showRepo })),
            { label: issueListTitle(config), className: 'ghx-issue-list__items' },
          )
        : emptyMessage(config),
      footer(result, failure !== null),
    ]);
  }

  function load(forceRefresh: boolean): void {
    generation += 1;
    const current = generation;
    const isCurrent = (): boolean =>
      !disposed && !context.signal.aborted && current === generation;
    root.setAttribute('aria-busy', 'true');
    fetchIssues(context, config, forceRefresh).then(
      (result) => {
        if (!isCurrent()) {
          return;
        }
        root.removeAttribute('aria-busy');
        lastResult = result;
        render(result, null);
      },
      (error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        root.removeAttribute('aria-busy');
        const failure = toApiErrorInfo(error);
        if (lastResult === null) {
          root.replaceChildren(failureState([failure]));
        } else {
          render(lastResult, failure);
        }
      },
    );
  }

  const stopRefresh = context.onRefresh((reason: RefreshReason) => load(reason === 'manual'));
  load(false);

  return () => {
    disposed = true;
    stopRefresh();
    root.remove();
  };
}
