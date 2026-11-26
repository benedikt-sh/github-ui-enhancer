import type { CheckState, PullRequestItem, ReviewDecision } from '../shared/types.ts';
import { actorLink, commentCount, itemRow, statusIcon, statusText } from './row.ts';
import type { Status } from './row.ts';
import { relativeTime } from './time.ts';
import type { DateInput } from './time.ts';

export function pullRequestStatus(pr: Pick<PullRequestItem, 'state' | 'isDraft'>): Status {
  if (pr.state === 'merged') {
    return { icon: 'git-merge', tone: 'done', label: 'Merged pull request' };
  }
  if (pr.state === 'closed') {
    return { icon: 'git-pull-request-closed', tone: 'danger', label: 'Closed pull request' };
  }
  if (pr.isDraft) {
    return { icon: 'git-pull-request-draft', tone: 'muted', label: 'Draft pull request' };
  }
  return { icon: 'git-pull-request', tone: 'success', label: 'Open pull request' };
}

const REVIEW_STATUS: Record<ReviewDecision, Status> = {
  approved: { icon: 'check', tone: 'success', label: 'Approved' },
  changes_requested: { icon: 'x-circle', tone: 'danger', label: 'Changes requested' },
  review_required: { icon: 'eye', tone: 'attention', label: 'Review required' },
};

export function reviewStatus(decision: ReviewDecision): Status {
  return REVIEW_STATUS[decision];
}

const CHECK_STATUS: Record<CheckState, Status> = {
  success: { icon: 'check', tone: 'success', label: 'All checks have passed' },
  failure: { icon: 'x', tone: 'danger', label: 'Some checks were not successful' },
  error: { icon: 'x', tone: 'danger', label: 'Some checks errored' },
  pending: { icon: 'dot-fill', tone: 'attention', label: 'Some checks are pending' },
  expected: { icon: 'dot-fill', tone: 'attention', label: 'Some checks are expected' },
};

export function checkStatus(state: CheckState): Status {
  return CHECK_STATUS[state];
}

export interface PullRequestRowOptions {
  readonly now: DateInput;
  /** Hide the repository in widgets that only show a single one. */
  readonly showRepo?: boolean;
}

export function pullRequestRow(
  pr: PullRequestItem,
  options: PullRequestRowOptions,
): HTMLLIElement {
  return itemRow({
    id: pr.id,
    className: 'ghx-row--pull-request',
    status: pullRequestStatus(pr),
    repo: options.showRepo === false ? null : pr.repo,
    title: pr.title,
    url: pr.url,
    labels: pr.labels,
    meta: [
      `#${pr.number}`,
      ['by ', actorLink(pr.author)],
      pr.reviewDecision ? statusText(reviewStatus(pr.reviewDecision)) : null,
      ['updated ', relativeTime(pr.updatedAt, options.now)],
    ],
    side: [
      pr.checkState ? statusIcon(checkStatus(pr.checkState), 'ghx-row__checks') : null,
      commentCount(pr.commentCount),
    ],
  });
}
