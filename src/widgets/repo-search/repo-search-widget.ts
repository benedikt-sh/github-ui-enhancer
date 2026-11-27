import type { WidgetDefinition } from '../../shared/widget.ts';
import { openUrlIn } from './open-url.ts';
import type { OpenUrl } from './open-url.ts';
import { defaultRepoSearchConfig, parseRepoSearchConfig } from './repo-search-config.ts';
import type { RepoSearchConfig } from './repo-search-config.ts';
import { mountRepoSearch } from './repo-search-view.ts';

export interface RepoSearchDependencies {
  /** Clock in epoch milliseconds for relative times and the recency ranking. */
  readonly now?: () => number;
  readonly openUrl?: OpenUrl;
}

const TITLE = 'Repository search';

export function createRepoSearchWidget(
  dependencies: RepoSearchDependencies = {},
): WidgetDefinition<RepoSearchConfig> {
  const now = dependencies.now ?? Date.now;
  const openUrl = dependencies.openUrl ?? ((url, newTab) => openUrlIn(window, url, newTab));
  return {
    type: 'repo-search',
    title: TITLE,
    description: 'Search repositories across all your organizations.',
    singleton: true,
    presets: [],
    defaultConfig: defaultRepoSearchConfig,
    parseConfig: parseRepoSearchConfig,
    instanceTitle: () => TITLE,
    mount: (target, context, config) =>
      mountRepoSearch(target, context, config, { now, openUrl }),
    renderConfig: null,
  };
}

export const repoSearchWidget = createRepoSearchWidget();
