import type { TweakSettings } from '../../shared/tweaks.ts';

export interface Toggleable {
  start(): void;
  stop(): void;
}

export interface TweakTargets {
  readonly dashboard: Toggleable;
  readonly changelogHider: Toggleable;
  readonly headerPins: Toggleable;
  readonly fileIcons: Toggleable;
  readonly quickSwitcher: Toggleable;
}

/** All targets ignore repeated starts and stops, so every settings change can be applied. */
export function applyTweaks(settings: TweakSettings, targets: TweakTargets): void {
  toggle(targets.dashboard, settings['dashboard.enhanced']);
  toggle(targets.changelogHider, settings['dashboard.hideChangelog']);
  toggle(targets.headerPins, settings['header.pinnedRepos']);
  toggle(targets.fileIcons, settings['repository.fileIcons']);
  toggle(targets.quickSwitcher, settings['navigation.quickSwitcher']);
}

function toggle(target: Toggleable, enabled: boolean): void {
  if (enabled) {
    target.start();
  } else {
    target.stop();
  }
}
