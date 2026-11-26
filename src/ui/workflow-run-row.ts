import type {
  WorkflowRunConclusion,
  WorkflowRunItem,
  WorkflowRunStatus,
} from '../shared/types.ts';
import { h } from './dom.ts';
import { icon } from './octicons.ts';
import { actorLink, itemRow } from './row.ts';
import type { Status } from './row.ts';
import { formatDuration, relativeTime, toTimestamp } from './time.ts';
import type { DateInput } from './time.ts';

const CONCLUSION_STATUS: Record<WorkflowRunConclusion, Status> = {
  success: { icon: 'check-circle', tone: 'success', label: 'Success' },
  failure: { icon: 'x-circle', tone: 'danger', label: 'Failure' },
  startup_failure: { icon: 'x-circle', tone: 'danger', label: 'Startup failure' },
  timed_out: { icon: 'x-circle', tone: 'danger', label: 'Timed out' },
  cancelled: { icon: 'stop', tone: 'muted', label: 'Cancelled' },
  skipped: { icon: 'skip', tone: 'muted', label: 'Skipped' },
  neutral: { icon: 'skip', tone: 'muted', label: 'Neutral' },
  stale: { icon: 'alert', tone: 'muted', label: 'Stale' },
  action_required: { icon: 'alert', tone: 'attention', label: 'Action required' },
};

const PENDING_STATUS: Record<Exclude<WorkflowRunStatus, 'completed'>, Status> = {
  in_progress: { icon: 'dot-fill', tone: 'attention', label: 'In progress' },
  queued: { icon: 'clock', tone: 'attention', label: 'Queued' },
  waiting: { icon: 'clock', tone: 'attention', label: 'Waiting' },
  requested: { icon: 'clock', tone: 'attention', label: 'Requested' },
  pending: { icon: 'clock', tone: 'attention', label: 'Pending' },
};

export function workflowRunStatus(run: Pick<WorkflowRunItem, 'status' | 'conclusion'>): Status {
  if (run.status !== 'completed') {
    return PENDING_STATUS[run.status];
  }
  return run.conclusion
    ? CONCLUSION_STATUS[run.conclusion]
    : { icon: 'check-circle', tone: 'muted', label: 'Completed' };
}

/**
 * Completed runs last until their final update, running ones until `now`. Queued runs have no
 * duration yet, so the result is null.
 */
export function workflowRunDuration(run: WorkflowRunItem, now: DateInput): number | null {
  if (run.status !== 'completed' && run.status !== 'in_progress') {
    return null;
  }
  const start = toTimestamp(run.runStartedAt ?? run.createdAt);
  const end = run.status === 'completed' ? toTimestamp(run.updatedAt) : toTimestamp(now);
  const duration = end - start;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export interface WorkflowRunRowOptions {
  readonly now: DateInput;
}

export function workflowRunRow(
  run: WorkflowRunItem,
  options: WorkflowRunRowOptions,
): HTMLLIElement {
  const status = workflowRunStatus(run);
  const duration = workflowRunDuration(run, options.now);
  const durationLabel = run.status === 'completed' ? 'Run duration' : 'Running for';
  return itemRow({
    id: run.id,
    className: ['ghx-row--workflow-run', run.status === 'in_progress' && 'ghx-row--running'],
    status,
    title: run.displayTitle,
    url: run.url,
    meta: [
      h('span', { className: 'ghx-row__workflow' }, run.workflowName),
      `#${run.runNumber}`,
      run.runAttempt > 1 ? `attempt ${run.runAttempt}` : null,
      run.event.replaceAll('_', ' '),
      run.branch ? h('span', { className: 'ghx-branch', title: run.branch }, run.branch) : null,
      ['by ', actorLink(run.actor)],
    ],
    side: [
      duration === null
        ? null
        : h(
            'span',
            {
              className: 'ghx-row__duration',
              title: durationLabel,
              'aria-label': `${durationLabel}: ${formatDuration(duration)}`,
              role: 'img',
            },
            icon('clock'),
            h('span', { 'aria-hidden': 'true' }, formatDuration(duration)),
          ),
      relativeTime(run.createdAt, options.now),
    ],
  });
}
