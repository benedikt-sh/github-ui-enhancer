import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityKinds,
  defaultRecentReposConfig,
  isLimit,
  normalizeTitle,
  parseRecentReposConfig,
  RECENT_REPOS_PRESETS,
  recentReposTitle,
} from './recent-repos-config.ts';

describe('recent repos config', () => {
  it('defaults to code changes with ten repositories', () => {
    assert.deepEqual(defaultRecentReposConfig(), { title: null, activity: 'code', limit: 10 });
  });

  it('offers presets for code changes and all activity', () => {
    assert.deepEqual(
      RECENT_REPOS_PRESETS.map((preset) => [preset.id, preset.title, preset.config]),
      [
        ['recently-changed', 'Recently changed', { title: null, activity: 'code', limit: 10 }],
        ['all-activity', 'All recent activity', { title: null, activity: 'all', limit: 10 }],
      ],
    );
  });

  it('maps the activity to event kinds', () => {
    assert.deepEqual(activityKinds('code'), ['push', 'pull_request', 'create']);
    assert.equal(activityKinds('all'), undefined);
  });

  it('accepts only the offered limits', () => {
    assert.equal(isLimit(5), true);
    assert.equal(isLimit(20), true);
    assert.equal(isLimit(50), false);
    assert.equal(isLimit('10'), false);
  });

  it('normalizes titles', () => {
    assert.equal(normalizeTitle('  Mine '), 'Mine');
    assert.equal(normalizeTitle('   '), null);
  });

  it('parses a valid config', () => {
    assert.deepEqual(parseRecentReposConfig({ title: ' Work ', activity: 'all', limit: 20 }), {
      title: 'Work',
      activity: 'all',
      limit: 20,
    });
  });

  it('falls back to defaults for anything that is not an object', () => {
    for (const raw of [null, undefined, 'code', 42, []]) {
      assert.deepEqual(parseRecentReposConfig(raw), defaultRecentReposConfig());
    }
  });

  it('falls back per field for invalid values', () => {
    assert.deepEqual(parseRecentReposConfig({ title: 7, activity: 'pushes', limit: 50 }), {
      title: null,
      activity: 'code',
      limit: 10,
    });
    assert.deepEqual(parseRecentReposConfig({ activity: 'all' }), {
      title: null,
      activity: 'all',
      limit: 10,
    });
  });

  it('derives the title from the activity unless one is set', () => {
    assert.equal(recentReposTitle(defaultRecentReposConfig()), 'Recently changed');
    assert.equal(
      recentReposTitle({ ...defaultRecentReposConfig(), activity: 'all' }),
      'All recent activity',
    );
    assert.equal(recentReposTitle({ ...defaultRecentReposConfig(), title: 'Mine' }), 'Mine');
  });
});
