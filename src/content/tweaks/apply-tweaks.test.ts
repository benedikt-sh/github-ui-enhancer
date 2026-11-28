import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyTweaks } from './apply-tweaks.ts';
import type { Toggleable } from './apply-tweaks.ts';

function recorder(calls: string[], name: string): Toggleable {
  return {
    start: () => calls.push(`${name}:start`),
    stop: () => calls.push(`${name}:stop`),
  };
}

describe('applyTweaks', () => {
  it('starts and stops every tweak target', () => {
    const calls: string[] = [];
    const targets = {
      dashboard: recorder(calls, 'dashboard'),
      changelogHider: recorder(calls, 'hider'),
      headerPins: recorder(calls, 'pins'),
      fileIcons: recorder(calls, 'icons'),
      quickSwitcher: recorder(calls, 'switcher'),
    };

    applyTweaks(
      {
        'dashboard.enhanced': true,
        'dashboard.hideChangelog': false,
        'header.pinnedRepos': false,
        'repository.fileIcons': true,
        'navigation.quickSwitcher': true,
      },
      targets,
    );
    applyTweaks(
      {
        'dashboard.enhanced': false,
        'dashboard.hideChangelog': true,
        'header.pinnedRepos': true,
        'repository.fileIcons': false,
        'navigation.quickSwitcher': false,
      },
      targets,
    );

    assert.deepEqual(calls, [
      'dashboard:start',
      'hider:stop',
      'pins:stop',
      'icons:start',
      'switcher:start',
      'dashboard:stop',
      'hider:start',
      'pins:start',
      'icons:stop',
      'switcher:stop',
    ]);
  });
});
