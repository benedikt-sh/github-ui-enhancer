import { isOneOf, isRecord } from '../../shared/guards.ts';
import type { RepoActivityKind } from '../../shared/types.ts';
import type { WidgetPreset } from '../../shared/widget.ts';

export const RECENT_REPOS_LIMITS = [5, 10, 20] as const;

export type RecentReposLimit = (typeof RECENT_REPOS_LIMITS)[number];

export const RECENT_REPOS_ACTIVITIES = ['code', 'all'] as const;

/** `code` counts only activities that change a repository, `all` every event. */
export type RecentReposActivity = (typeof RECENT_REPOS_ACTIVITIES)[number];

export interface RecentReposConfig {
  /** Custom widget title, null derives it from the activity. */
  readonly title: string | null;
  readonly activity: RecentReposActivity;
  readonly limit: RecentReposLimit;
}

export const DEFAULT_LIMIT: RecentReposLimit = 10;

export const CODE_ACTIVITY_KINDS: readonly RepoActivityKind[] = ['push', 'pull_request', 'create'];

function presetConfig(activity: RecentReposActivity): RecentReposConfig {
  return { title: null, activity, limit: DEFAULT_LIMIT };
}

export const ACTIVITY_TITLES: Readonly<Record<RecentReposActivity, string>> = {
  code: 'Recently changed',
  all: 'All recent activity',
};

export const RECENT_REPOS_PRESETS: readonly WidgetPreset<RecentReposConfig>[] = [
  { id: 'recently-changed', title: ACTIVITY_TITLES.code, config: presetConfig('code') },
  { id: 'all-activity', title: ACTIVITY_TITLES.all, config: presetConfig('all') },
];

export function defaultRecentReposConfig(): RecentReposConfig {
  return presetConfig('code');
}

/** Undefined means every kind counts. */
export function activityKinds(
  activity: RecentReposActivity,
): readonly RepoActivityKind[] | undefined {
  return activity === 'code' ? CODE_ACTIVITY_KINDS : undefined;
}

export function normalizeTitle(title: string): string | null {
  const trimmed = title.trim();
  return trimmed === '' ? null : trimmed;
}

export function isLimit(value: unknown): value is RecentReposLimit {
  return RECENT_REPOS_LIMITS.some((limit) => limit === value);
}

export function parseRecentReposConfig(raw: unknown): RecentReposConfig {
  const defaults = defaultRecentReposConfig();
  if (!isRecord(raw)) {
    return defaults;
  }
  const { title, activity, limit } = raw;
  return {
    title: typeof title === 'string' ? normalizeTitle(title) : defaults.title,
    activity: isOneOf(RECENT_REPOS_ACTIVITIES, activity) ? activity : defaults.activity,
    limit: isLimit(limit) ? limit : defaults.limit,
  };
}

export function recentReposTitle(config: RecentReposConfig): string {
  return config.title ?? ACTIVITY_TITLES[config.activity];
}
