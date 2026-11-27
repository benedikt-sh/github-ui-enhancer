import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultTweaks, parseTweaks, TWEAK_AREAS, TWEAKS, tweaksOfArea } from './tweaks.ts';

describe('tweaks', () => {
  it('enables the enhanced dashboard and keeps the changelog by default', () => {
    assert.deepEqual(defaultTweaks(), {
      'dashboard.enhanced': true,
      'dashboard.hideChangelog': false,
      'header.pinnedRepos': false,
    });
  });

  it('keeps stored booleans and falls back per key', () => {
    assert.deepEqual(
      parseTweaks({ 'dashboard.enhanced': false, 'dashboard.hideChangelog': 'yes', other: true }),
      {
        'dashboard.enhanced': false,
        'dashboard.hideChangelog': false,
        'header.pinnedRepos': false,
      },
    );
    assert.deepEqual(parseTweaks([true]), defaultTweaks());
  });

  it('assigns every tweak to a known area with unique ids', () => {
    const areas = TWEAK_AREAS.map((area) => area.id);
    const ids = TWEAKS.map((tweak) => tweak.id);

    assert.equal(new Set(ids).size, ids.length);
    for (const tweak of TWEAKS) {
      assert.ok(areas.includes(tweak.area), tweak.id);
    }
    assert.deepEqual(
      tweaksOfArea('dashboard').map((tweak) => tweak.id),
      ['dashboard.enhanced', 'dashboard.hideChangelog'],
    );
    assert.deepEqual(
      tweaksOfArea('header').map((tweak) => tweak.id),
      ['header.pinnedRepos'],
    );
  });
});
