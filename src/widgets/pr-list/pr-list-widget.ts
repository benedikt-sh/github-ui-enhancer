import type { WidgetDefinition } from '../../shared/widget.ts';
import {
  defaultPullRequestListConfig,
  parsePullRequestListConfig,
  PR_LIST_PRESETS,
  pullRequestListTitle,
} from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';
import { renderPullRequestListForm } from './pr-list-form.ts';
import { mountPullRequestList } from './pr-list-view.ts';
import type { Clock } from './pr-list-view.ts';

export interface PullRequestListWidgetOptions {
  /** Reference time for relative timestamps. */
  readonly now?: Clock;
}

export function createPullRequestListWidget(
  options: PullRequestListWidgetOptions = {},
): WidgetDefinition<PullRequestListConfig> {
  const clock = options.now ?? (() => new Date());
  return {
    type: 'pr-list',
    title: 'Pull requests',
    description: 'Pull requests matching a GitHub search, e.g. review requests or your own.',
    singleton: false,
    presets: PR_LIST_PRESETS,
    defaultConfig: defaultPullRequestListConfig,
    parseConfig: parsePullRequestListConfig,
    instanceTitle: pullRequestListTitle,
    mount: (target, context, config) => mountPullRequestList(target, context, config, clock),
    renderConfig: renderPullRequestListForm,
  };
}

export const pullRequestListWidget = createPullRequestListWidget();
