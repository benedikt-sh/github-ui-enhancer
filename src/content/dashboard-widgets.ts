import type { DashboardLayout, WidgetInstance, WidgetWidth } from '../shared/layout.ts';
import { createId as createRandomId } from '../shared/layout.ts';
import { eraseWidget } from '../shared/widget.ts';
import type { ErasedWidgetDefinition } from '../shared/widget.ts';
import { actionsRunsWidget } from '../widgets/actions-runs/actions-runs-widget.ts';
import { issueListWidget } from '../widgets/issue-list/issue-list-widget.ts';
import { pullRequestListWidget } from '../widgets/pr-list/pr-list-widget.ts';
import { recentReposWidget } from '../widgets/recent-repos/recent-repos-widget.ts';
import { repoSearchWidget } from '../widgets/repo-search/repo-search-widget.ts';

export const DASHBOARD_WIDGETS: readonly ErasedWidgetDefinition[] = [
  eraseWidget(repoSearchWidget),
  eraseWidget(pullRequestListWidget),
  eraseWidget(issueListWidget),
  eraseWidget(actionsRunsWidget),
  eraseWidget(recentReposWidget),
];

interface DefaultEntry {
  readonly type: string;
  readonly preset: string;
  readonly width: WidgetWidth;
}

// Actions runs are left out on purpose: without a chosen repository they would only show a picker.
const DEFAULT_ENTRIES: readonly DefaultEntry[] = [
  { type: pullRequestListWidget.type, preset: 'review-requested', width: 'half' },
  { type: pullRequestListWidget.type, preset: 'assigned', width: 'half' },
  { type: issueListWidget.type, preset: 'assigned', width: 'half' },
  { type: pullRequestListWidget.type, preset: 'created', width: 'half' },
  { type: issueListWidget.type, preset: 'watched', width: 'half' },
  { type: recentReposWidget.type, preset: 'recently-changed', width: 'half' },
];

export function createDefaultLayout(
  widgets: readonly ErasedWidgetDefinition[] = DASHBOARD_WIDGETS,
  createId: () => string = createRandomId,
): DashboardLayout {
  const instances: WidgetInstance[] = [];
  for (const entry of DEFAULT_ENTRIES) {
    const definition = widgets.find((candidate) => candidate.type === entry.type);
    if (definition === undefined) {
      continue;
    }
    const preset = definition.presets.find((candidate) => candidate.id === entry.preset);
    instances.push({
      id: createId(),
      type: entry.type,
      width: entry.width,
      config: preset === undefined ? definition.defaultConfig() : preset.config,
    });
  }
  return { version: 1, instances };
}
