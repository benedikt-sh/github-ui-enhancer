import type { WidgetDefinition } from '../../shared/widget.ts';
import {
  defaultRecentReposConfig,
  parseRecentReposConfig,
  RECENT_REPOS_PRESETS,
  recentReposTitle,
} from './recent-repos-config.ts';
import type { RecentReposConfig } from './recent-repos-config.ts';
import { renderRecentReposForm } from './recent-repos-form.ts';
import { mountRecentRepos } from './recent-repos-view.ts';
import type { Clock } from './recent-repos-view.ts';

export interface RecentReposWidgetOptions {
  /** Reference time for relative timestamps. */
  readonly now?: Clock;
}

export function createRecentReposWidget(
  options: RecentReposWidgetOptions = {},
): WidgetDefinition<RecentReposConfig> {
  const clock = options.now ?? (() => new Date());
  return {
    type: 'recent-repos',
    title: 'Recent repositories',
    description: 'Quick access to the repositories you recently pushed to or otherwise worked in.',
    singleton: false,
    presets: RECENT_REPOS_PRESETS,
    defaultConfig: defaultRecentReposConfig,
    parseConfig: parseRecentReposConfig,
    instanceTitle: recentReposTitle,
    mount: (target, context, config) => mountRecentRepos(target, context, config, clock),
    renderConfig: renderRecentReposForm,
  };
}

export const recentReposWidget = createRecentReposWidget();
