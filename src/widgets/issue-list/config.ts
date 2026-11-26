import { isOneOf, isRecord, isString } from '../../shared/guards.ts';
import type { WidgetPreset } from '../../shared/widget.ts';

export const ISSUE_SOURCES = ['search', 'subscribed'] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const ISSUE_LIMITS = [5, 10, 20, 50] as const;
export type IssueLimit = (typeof ISSUE_LIMITS)[number];

export interface IssueListConfig {
  readonly source: IssueSource;
  /** Custom title, null to derive it from the preset or the query. */
  readonly title: string | null;
  /** GitHub search syntax without `is:issue`, only used for the `search` source. */
  readonly query: string;
  readonly limit: IssueLimit;
  readonly showRepo: boolean;
}

export const ASSIGNED_QUERY = 'is:open archived:false assignee:@me';
export const CREATED_QUERY = 'is:open archived:false author:@me';
export const WATCHED_TITLE = 'Watched issues';
export const DEFAULT_LIMIT: IssueLimit = 10;

const BASE_CONFIG = { title: null, limit: DEFAULT_LIMIT, showRepo: true } as const;

export const ISSUE_LIST_PRESETS: readonly WidgetPreset<IssueListConfig>[] = [
  {
    id: 'assigned',
    title: 'Assigned to me',
    config: { ...BASE_CONFIG, source: 'search', query: ASSIGNED_QUERY },
  },
  {
    id: 'watched',
    title: WATCHED_TITLE,
    config: { ...BASE_CONFIG, source: 'subscribed', query: '' },
  },
  {
    id: 'created',
    title: 'Created by me',
    config: { ...BASE_CONFIG, source: 'search', query: CREATED_QUERY },
  },
];

export function defaultIssueListConfig(): IssueListConfig {
  return { ...BASE_CONFIG, source: 'search', query: ASSIGNED_QUERY };
}

function isLimit(value: unknown): value is IssueLimit {
  return (ISSUE_LIMITS as readonly unknown[]).includes(value);
}

/** Collapses whitespace so stored queries compare equal to the presets. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function parseIssueListConfig(raw: unknown): IssueListConfig {
  const fields = isRecord(raw) ? raw : {};
  const source = isOneOf(ISSUE_SOURCES, fields['source']) ? fields['source'] : 'search';
  const rawTitle = fields['title'];
  const title = isString(rawTitle) && rawTitle.trim() !== '' ? rawTitle.trim() : null;
  const rawQuery = fields['query'];
  const query = isString(rawQuery) ? normalizeQuery(rawQuery) : '';
  const rawLimit = fields['limit'];
  const rawShowRepo = fields['showRepo'];
  return {
    source,
    title,
    query: source === 'search' && query === '' ? ASSIGNED_QUERY : query,
    limit: isLimit(rawLimit) ? rawLimit : DEFAULT_LIMIT,
    showRepo: typeof rawShowRepo === 'boolean' ? rawShowRepo : true,
  };
}

/** Presets are identified by source and query only, limit and display options do not matter. */
export function matchingPreset(config: IssueListConfig): WidgetPreset<IssueListConfig> | null {
  return (
    ISSUE_LIST_PRESETS.find(
      (preset) =>
        preset.config.source === config.source &&
        (config.source === 'subscribed' ||
          preset.config.query === normalizeQuery(config.query)),
    ) ?? null
  );
}

/** The title without the custom one, also used as placeholder in the config form. */
export function automaticTitle(config: IssueListConfig): string {
  return matchingPreset(config)?.title ?? normalizeQuery(config.query);
}

export function issueListTitle(config: IssueListConfig): string {
  return config.title ?? automaticTitle(config);
}

/**
 * GitHub has no issue search qualifier for subscriptions, the closest page is the list of
 * thread subscriptions in the notification settings.
 */
export const SUBSCRIPTIONS_URL = 'https://github.com/notifications/subscriptions';

export function viewAllUrl(config: IssueListConfig): string {
  if (config.source === 'subscribed') {
    return SUBSCRIPTIONS_URL;
  }
  return `https://github.com/issues?q=${encodeURIComponent(`is:issue ${config.query}`)}`;
}
