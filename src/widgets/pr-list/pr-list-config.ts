import { isRecord } from '../../shared/guards.ts';
import type { WidgetPreset } from '../../shared/widget.ts';

export const PR_LIST_LIMITS = [5, 10, 20, 50] as const;

export type PullRequestListLimit = (typeof PR_LIST_LIMITS)[number];

export interface PullRequestListConfig {
  /** Custom widget title, null derives it from the query. */
  readonly title: string | null;
  /** GitHub search syntax without `is:pr`. */
  readonly query: string;
  readonly limit: PullRequestListLimit;
  readonly showRepo: boolean;
}

export const DEFAULT_LIMIT: PullRequestListLimit = 10;

const REVIEW_REQUESTED_QUERY = 'is:open archived:false review-requested:@me';

function presetConfig(query: string): PullRequestListConfig {
  return { title: null, query, limit: DEFAULT_LIMIT, showRepo: true };
}

export const PR_LIST_PRESETS: readonly WidgetPreset<PullRequestListConfig>[] = [
  {
    id: 'assigned',
    title: 'Assigned to me',
    config: presetConfig('is:open archived:false assignee:@me'),
  },
  {
    id: 'review-requested',
    title: 'Review requested',
    config: presetConfig(REVIEW_REQUESTED_QUERY),
  },
  {
    id: 'created',
    title: 'Created by me',
    config: presetConfig('is:open archived:false author:@me'),
  },
];

export function defaultPullRequestListConfig(): PullRequestListConfig {
  return presetConfig(REVIEW_REQUESTED_QUERY);
}

/** Collapses whitespace, so hand typed queries still match presets and cache keys. */
export function normalizeQuery(query: string): string {
  return query.trim().split(/\s+/).join(' ');
}

export function normalizeTitle(title: string): string | null {
  const trimmed = title.trim();
  return trimmed === '' ? null : trimmed;
}

export function isLimit(value: unknown): value is PullRequestListLimit {
  return PR_LIST_LIMITS.some((limit) => limit === value);
}

export function parsePullRequestListConfig(raw: unknown): PullRequestListConfig {
  const defaults = defaultPullRequestListConfig();
  if (!isRecord(raw)) {
    return defaults;
  }
  const { title, query, limit, showRepo } = raw;
  const normalizedQuery = typeof query === 'string' ? normalizeQuery(query) : '';
  return {
    title: typeof title === 'string' ? normalizeTitle(title) : defaults.title,
    query: normalizedQuery === '' ? defaults.query : normalizedQuery,
    limit: isLimit(limit) ? limit : defaults.limit,
    showRepo: typeof showRepo === 'boolean' ? showRepo : defaults.showRepo,
  };
}

export function findPreset(query: string): WidgetPreset<PullRequestListConfig> | null {
  const normalized = normalizeQuery(query);
  return PR_LIST_PRESETS.find((preset) => preset.config.query === normalized) ?? null;
}

export function pullRequestListTitle(config: PullRequestListConfig): string {
  return config.title ?? findPreset(config.query)?.title ?? normalizeQuery(config.query);
}

export function pullRequestSearchUrl(query: string): string {
  return `https://github.com/pulls?q=${encodeURIComponent(`is:pr ${normalizeQuery(query)}`)}`;
}
