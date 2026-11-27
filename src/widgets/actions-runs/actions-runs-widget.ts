import type { WidgetDefinition } from '../../shared/widget.ts';
import { renderActionsRunsConfig } from './config-form.ts';
import type { ActionsRunsConfig } from './config.ts';
import { actionsRunsTitle, defaultActionsRunsConfig, parseActionsRunsConfig } from './config.ts';
import { ACTIVE_POLL_INTERVAL, mountRunsView } from './runs-view.ts';
import type { RunsViewEnvironment } from './runs-view.ts';

export const ACTIONS_RUNS_TYPE = 'actions-runs';

export function browserEnvironment(doc: Document = document): RunsViewEnvironment {
  return {
    now: () => Date.now(),
    schedule(callback, delay) {
      const handle = setTimeout(callback, delay);
      return () => clearTimeout(handle);
    },
    isVisible: () => doc.visibilityState === 'visible',
    onVisibilityChange(listener) {
      doc.addEventListener('visibilitychange', listener);
      return () => doc.removeEventListener('visibilitychange', listener);
    },
    activePollInterval: ACTIVE_POLL_INTERVAL,
  };
}

/** `createEnvironment` runs per mount, so the default only touches `document` in the page. */
export function createActionsRunsWidget(
  createEnvironment: () => RunsViewEnvironment = browserEnvironment,
): WidgetDefinition<ActionsRunsConfig> {
  return {
    type: ACTIONS_RUNS_TYPE,
    title: 'Actions runs',
    description:
      'Recent GitHub Actions runs of a repository, optionally for one branch or failed runs only.',
    singleton: false,
    presets: [],
    defaultConfig: defaultActionsRunsConfig,
    parseConfig: parseActionsRunsConfig,
    instanceTitle: actionsRunsTitle,
    mount: (target, context, config) =>
      mountRunsView(target, context, config, createEnvironment()),
    renderConfig: (target, context) =>
      renderActionsRunsConfig(target, context, createEnvironment()),
  };
}

export const actionsRunsWidget = createActionsRunsWidget();
