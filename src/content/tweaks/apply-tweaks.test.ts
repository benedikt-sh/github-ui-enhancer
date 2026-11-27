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
  it('starts and stops the dashboard and the changelog hider', () => {
    const calls: string[] = [];
    const targets = {
      dashboard: recorder(calls, 'dashboard'),
      changelogHider: recorder(calls, 'hider'),
    };

    applyTweaks({ 'dashboard.enhanced': true, 'dashboard.hideChangelog': false }, targets);
    applyTweaks({ 'dashboard.enhanced': false, 'dashboard.hideChangelog': true }, targets);

    assert.deepEqual(calls, ['dashboard:start', 'hider:stop', 'dashboard:stop', 'hider:start']);
  });
});
