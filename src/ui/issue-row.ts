import type { IssueItem } from '../shared/types.ts';
import { actorLink, avatarStack, commentCount, itemRow } from './row.ts';
import type { Status } from './row.ts';
import { relativeTime } from './time.ts';
import type { DateInput } from './time.ts';

export function issueStatus(issue: Pick<IssueItem, 'state' | 'stateReason'>): Status {
  if (issue.state === 'open') {
    return { icon: 'issue-opened', tone: 'success', label: 'Open issue' };
  }
  if (issue.stateReason === 'not_planned') {
    return { icon: 'skip', tone: 'muted', label: 'Closed as not planned' };
  }
  if (issue.stateReason === 'duplicate') {
    return { icon: 'skip', tone: 'muted', label: 'Closed as duplicate' };
  }
  return { icon: 'issue-closed', tone: 'done', label: 'Closed as completed' };
}

export interface IssueRowOptions {
  readonly now: DateInput;
  /** Hide the repository in widgets that only show a single one. */
  readonly showRepo?: boolean;
}

export function issueRow(issue: IssueItem, options: IssueRowOptions): HTMLLIElement {
  return itemRow({
    id: issue.id,
    className: 'ghx-row--issue',
    status: issueStatus(issue),
    repo: options.showRepo === false ? null : issue.repo,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    meta: [
      `#${issue.number}`,
      ['by ', actorLink(issue.author)],
      ['updated ', relativeTime(issue.updatedAt, options.now)],
    ],
    side: [avatarStack(issue.assignees, 'Assigned to'), commentCount(issue.commentCount)],
  });
}
