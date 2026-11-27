import type { DataResult } from '../../shared/data.ts';
import { toApiErrorInfo } from '../../shared/errors.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RepoRef, WorkflowRunItem, WorkflowRunStatus } from '../../shared/types.ts';
import type { Dispose, WidgetContext } from '../../shared/widget.ts';
import { appendChildren, h, safeUrl } from '../../ui/dom.ts';
import { notice } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import { itemList, repoLink } from '../../ui/row.ts';
import { emptyState, errorState, isTokenError, loadingState } from '../../ui/states.ts';
import { formatAbsoluteTime, formatRelativeTime } from '../../ui/time.ts';
import { workflowRunRow } from '../../ui/workflow-run-row.ts';
import { branchSelect } from './branch-select.ts';
import type { ActionsRunsConfig } from './config.ts';
import { runsPageUrl } from './config.ts';
import { partialErrorNotice } from './partial-errors.ts';
import { repoPicker } from './repo-picker.ts';

export interface RunsViewEnvironment {
  /** Epoch milliseconds. */
  now(): number;
  /** Runs `callback` once after `delay` milliseconds, the returned function cancels it. */
  schedule(callback: () => void, delay: number): Dispose;
  isVisible(): boolean;
  onVisibilityChange(listener: () => void): Dispose;
  /** Poll interval while a listed run is active, in milliseconds. */
  readonly activePollInterval: number;
}

export const ACTIVE_POLL_INTERVAL = 30_000;

// `waiting` runs wait for a deployment approval, which can take days, so they do not count.
const ACTIVE_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  'queued',
  'in_progress',
  'requested',
  'pending',
]);

export function isActiveRun(run: Pick<WorkflowRunItem, 'status'>): boolean {
  return ACTIVE_STATUSES.has(run.status);
}

interface LoadOptions {
  readonly forceRefresh: boolean;
  readonly showLoading: boolean;
}

function errorTitle(errors: readonly ApiErrorInfo[]): string {
  return errors.some((error) => isTokenError(error.kind))
    ? 'No access to the workflow runs'
    : 'Could not load workflow runs';
}

export function mountRunsView(
  target: HTMLElement,
  context: WidgetContext<ActionsRunsConfig>,
  initialConfig: ActionsRunsConfig,
  env: RunsViewEnvironment,
): Dispose {
  let config = initialConfig;
  let disposed = false;
  let request = 0;
  let hasActiveRuns = false;
  let cancelPoll: Dispose | null = null;
  const cleanups: Dispose[] = [];

  const status = h('div', { className: 'ghx-actions-runs__status' });
  const main = h('div', { className: 'ghx-actions-runs__main' });
  const root = h('div', { className: 'ghx-actions-runs' }, status, main);
  target.replaceChildren(root);

  let content: HTMLElement = main;
  let footer: HTMLElement = main;

  const live = (): boolean => !disposed && !context.signal.aborted;
  const openOptions = (): void => context.openOptions();

  const save = (next: ActionsRunsConfig): void => {
    config = next;
    status.replaceChildren();
    context.saveConfig(next).catch(() => {
      if (live()) {
        status.replaceChildren(
          notice({ variant: 'warning', message: 'The change could not be saved.' }),
        );
      }
    });
  };

  const stopPolling = (): void => {
    cancelPoll?.();
    cancelPoll = null;
  };

  const updatePolling = (): void => {
    stopPolling();
    if (live() && hasActiveRuns && env.isVisible()) {
      cancelPoll = env.schedule(() => {
        cancelPoll = null;
        if (env.isVisible()) {
          load({ forceRefresh: false, showLoading: false });
        }
      }, env.activePollInterval);
    }
  };

  const renderFooter = (repo: RepoRef, result: DataResult<unknown> | null): void => {
    footer.replaceChildren();
    appendChildren(footer, [
      result?.stale
        ? h(
            'span',
            {
              className: 'ghx-actions-runs__stale',
              title: `Fetched ${formatAbsoluteTime(result.fetchedAt)}`,
            },
            icon('clock'),
            `Outdated, fetched ${formatRelativeTime(result.fetchedAt, env.now())}`,
          )
        : null,
      h(
        'a',
        {
          className: 'ghx-link ghx-actions-runs__all',
          href: safeUrl(runsPageUrl(repo, config.branch, config.status)),
        },
        'View all runs',
      ),
    ]);
  };

  const retry = (): void => load({ forceRefresh: true, showLoading: true });

  const renderResult = (repo: RepoRef, result: DataResult<WorkflowRunItem[]>): void => {
    const runs = result.data.slice(0, config.limit);
    content.replaceChildren();
    if (runs.length === 0 && result.errors.length > 0) {
      content.append(
        errorState(result.errors, {
          title: errorTitle(result.errors),
          onOpenSettings: openOptions,
          onRetry: retry,
        }),
      );
    } else {
      appendChildren(content, [
        partialErrorNotice(result.errors, openOptions),
        runs.length > 0
          ? itemList(
              runs.map((run) => workflowRunRow(run, { now: env.now() })),
              { label: 'Workflow runs', className: 'ghx-actions-runs__list' },
            )
          : emptyState({
              icon: 'workflow',
              title: 'No workflow runs',
              description:
                config.branch === null
                  ? 'This repository has no workflow runs yet.'
                  : `There are no workflow runs on ${config.branch}.`,
            }),
      ]);
    }
    renderFooter(repo, result);
    hasActiveRuns = runs.some(isActiveRun);
    updatePolling();
  };

  function load(options: LoadOptions): void {
    const { repo } = config;
    if (repo === null || !live()) {
      return;
    }
    request += 1;
    const current = request;
    const isCurrent = (): boolean => current === request && live();
    stopPolling();
    if (options.showLoading) {
      content.replaceChildren(loadingState('Loading workflow runs...'));
    }
    context.data
      .workflowRuns(repo, {
        limit: config.limit,
        forceRefresh: options.forceRefresh,
        ...(config.branch === null ? {} : { branch: config.branch }),
      })
      .then(
        (result) => {
          if (isCurrent()) {
            renderResult(repo, result);
          }
        },
        (error: unknown) => {
          if (isCurrent()) {
            content.replaceChildren(
              errorState([toApiErrorInfo(error)], {
                title: 'Could not load workflow runs',
                onOpenSettings: openOptions,
                onRetry: retry,
              }),
            );
            renderFooter(repo, null);
            hasActiveRuns = false;
          }
        },
      );
  }

  const showRuns = (repo: RepoRef): void => {
    const branches = branchSelect({
      data: context.data,
      repo,
      value: config.branch,
      signal: context.signal,
      lazy: true,
      ariaLabel: 'Branch',
      className: 'ghx-actions-runs__branch',
      onChange: (branch) => {
        save({ ...config, branch });
        renderFooter(repo, null);
        load({ forceRefresh: false, showLoading: true });
      },
    });
    content = h('div', { className: 'ghx-actions-runs__content' });
    footer = h('div', { className: 'ghx-actions-runs__footer' });
    main.replaceChildren(
      h(
        'div',
        { className: 'ghx-actions-runs__header' },
        icon('repo'),
        repoLink(repo),
        h(
          'span',
          { className: 'ghx-actions-runs__branch-picker' },
          icon('git-branch'),
          branches.element,
        ),
      ),
      content,
      footer,
    );
    renderFooter(repo, null);
    load({ forceRefresh: false, showLoading: true });
  };

  const showPicker = (): void => {
    const picker = repoPicker({
      data: context.data,
      signal: context.signal,
      now: env.now,
      selected: null,
      onOpenSettings: openOptions,
      onSelect: (repo) => {
        const next = { ...config, repo: { owner: repo.owner, name: repo.name }, branch: null };
        save(next);
        showRuns(next.repo);
      },
    });
    main.replaceChildren(
      h(
        'div',
        { className: 'ghx-actions-runs__choose' },
        h(
          'p',
          { className: 'ghx-actions-runs__intro' },
          'Choose a repository to show its workflow runs.',
        ),
        picker.root,
      ),
    );
  };

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    stopPolling();
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    context.signal.removeEventListener('abort', dispose);
  }

  cleanups.push(
    context.onRefresh((reason) => {
      load({ forceRefresh: reason === 'manual', showLoading: false });
    }),
    env.onVisibilityChange(updatePolling),
  );
  context.signal.addEventListener('abort', dispose, { once: true });

  if (config.repo === null) {
    showPicker();
  } else {
    showRuns(config.repo);
  }

  return dispose;
}
