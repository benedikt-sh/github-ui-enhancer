import type { RecentRepoItem, RepoActivityKind } from '../../shared/types.ts';
import { h, safeUrl } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';
import type { IconName } from '../../ui/octicons.ts';
import { repoUrl } from '../../ui/row.ts';
import { relativeTime } from '../../ui/time.ts';

const ACTIVITY_ICONS: Readonly<Record<RepoActivityKind, IconName>> = {
  push: 'git-branch',
  pull_request: 'git-pull-request',
  review: 'eye',
  issue: 'issue-opened',
  comment: 'comment',
  create: 'plus',
  release: 'archive',
  other: 'repo',
};

/** A short sentence about the newest activity, e.g. "Pushed to main". */
export function describeActivity(item: Pick<RecentRepoItem, 'lastActivity' | 'branch'>): string {
  const { branch } = item;
  switch (item.lastActivity) {
    case 'push':
      return branch === null ? 'Pushed' : `Pushed to ${branch}`;
    case 'pull_request':
      return 'Opened or updated a pull request';
    case 'review':
      return 'Reviewed a pull request';
    case 'issue':
      return 'Opened or updated an issue';
    case 'comment':
      return 'Commented';
    case 'create':
      // GitHub reports tags and new repositories as create events without a branch.
      return branch === null ? 'Created a tag or the repository' : `Created branch ${branch}`;
    case 'release':
      return 'Published a release';
    case 'other':
      return 'Other activity';
  }
}

function activityCounter(count: number): HTMLSpanElement {
  const label = `${count} recent event${count === 1 ? '' : 's'}`;
  return h(
    'span',
    {
      className: 'ghx-counter ghx-recent-repos__count',
      title: label,
      'aria-label': label,
      role: 'img',
    },
    h('span', { 'aria-hidden': 'true' }, count),
  );
}

function quickLink(label: string, iconName: IconName, url: string): HTMLAnchorElement {
  return h(
    'a',
    {
      className: 'ghx-recent-repos__quick-link',
      href: safeUrl(url),
      title: label,
      'aria-label': label,
    },
    icon(iconName),
  );
}

function repoTitle(item: RecentRepoItem): HTMLAnchorElement {
  const { owner, name } = item.repo;
  return h(
    'a',
    { className: 'ghx-row__title ghx-recent-repos__repo', href: safeUrl(repoUrl(item.repo)) },
    h('span', { className: 'ghx-recent-repos__owner' }, `${owner}/`),
    name,
  );
}

export function recentRepoRow(item: RecentRepoItem, now: Date): HTMLLIElement {
  const fullName = `${item.repo.owner}/${item.repo.name}`;
  const url = repoUrl(item.repo);
  return h(
    'li',
    { className: 'ghx-row ghx-recent-repos__row', dataset: { repo: fullName } },
    h(
      'span',
      { className: 'ghx-row__icon ghx-tone--muted' },
      icon(ACTIVITY_ICONS[item.lastActivity]),
    ),
    h(
      'div',
      { className: 'ghx-row__main' },
      h('div', { className: 'ghx-row__title-line' }, repoTitle(item)),
      h(
        'div',
        { className: 'ghx-row__meta' },
        h('span', { className: 'ghx-row__meta-item' }, describeActivity(item)),
        h('span', { className: 'ghx-row__meta-item' }, relativeTime(item.lastActivityAt, now)),
      ),
    ),
    h(
      'div',
      { className: 'ghx-row__side' },
      activityCounter(item.activityCount),
      h(
        'span',
        { className: 'ghx-recent-repos__quick-links' },
        quickLink(`Pull requests of ${fullName}`, 'git-pull-request', `${url}/pulls`),
        quickLink(`Actions of ${fullName}`, 'play', `${url}/actions`),
      ),
    ),
  );
}
