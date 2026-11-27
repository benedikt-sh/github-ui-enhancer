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
  it('starts and stops the dashboard, the changelog hider and the header pins', () => {
    const calls: string[] = [];
    const targets = {
      dashboard: recorder(calls, 'dashboard'),
      changelogHider: recorder(calls, 'hider'),
      headerPins: recorder(calls, 'pins'),
    };

    applyTweaks(
      {
        'dashboard.enhanced': true,
        'dashboard.hideChangelog': false,
        'header.pinnedRepos': false,
      },
      targets,
    );
    applyTweaks(
      {
        'dashboard.enhanced': false,
        'dashboard.hideChangelog': true,
        'header.pinnedRepos': true,
      },
      targets,
    );

    assert.deepEqual(calls, [
      'dashboard:start',
      'hider:stop',
      'pins:stop',
      'dashboard:stop',
      'hider:start',
      'pins:start',
    ]);
  });
});
