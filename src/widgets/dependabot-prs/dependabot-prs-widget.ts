import type { WidgetDefinition } from '../../shared/widget.ts';
import {
  defaultDependabotPrsConfig,
  dependabotPrsTitle,
  parseDependabotPrsConfig,
} from './dependabot-prs-config.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';
import { renderDependabotPrsForm } from './dependabot-prs-form.ts';
import { mountDependabotPrs } from './dependabot-prs-view.ts';
import type { Clock } from './dependabot-prs-view.ts';

export const DEPENDABOT_PRS_TYPE = 'dependabot-prs';

export interface DependabotPrsWidgetOptions {
  /** Reference time for relative timestamps and the repo search ranking. */
  readonly now?: Clock;
}

export function createDependabotPrsWidget(
  options: DependabotPrsWidgetOptions = {},
): WidgetDefinition<DependabotPrsConfig> {
  const clock = options.now ?? (() => new Date());
  return {
    type: DEPENDABOT_PRS_TYPE,
    title: 'Dependabot pull requests',
    description: 'Open Dependabot pull requests of selected repositories.',
    singleton: false,
    presets: [],
    defaultConfig: defaultDependabotPrsConfig,
    parseConfig: parseDependabotPrsConfig,
    instanceTitle: dependabotPrsTitle,
    mount: (target, context, config) => mountDependabotPrs(target, context, config, clock),
    renderConfig: (target, context) =>
      renderDependabotPrsForm(target, context, { now: () => clock().getTime() }),
  };
}

export const dependabotPrsWidget = createDependabotPrsWidget();
