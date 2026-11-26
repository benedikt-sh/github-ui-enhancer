import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultPullRequestListConfig,
  findPreset,
  isLimit,
  normalizeQuery,
  normalizeTitle,
  parsePullRequestListConfig,
  PR_LIST_PRESETS,
  pullRequestListTitle,
  pullRequestSearchUrl,
} from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';

const REVIEW_QUERY = 'is:open archived:false review-requested:@me';

describe('presets', () => {
  it('offers assigned, review requested and created by me', () => {
    assert.deepEqual(
      PR_LIST_PRESETS.map((preset) => [preset.id, preset.title, preset.config.query]),
      [
        ['assigned', 'Assigned to me', 'is:open archived:false assignee:@me'],
        ['review-requested', 'Review requested', REVIEW_QUERY],
        ['created', 'Created by me', 'is:open archived:false author:@me'],
      ],
    );
    for (const preset of PR_LIST_PRESETS) {
      assert.equal(preset.config.title, null);
      assert.equal(preset.config.limit, 10);
      assert.equal(preset.config.showRepo, true);
    }
  });

  it('uses the review requested preset as default config', () => {
    assert.deepEqual(defaultPullRequestListConfig(), {
      title: null,
      query: REVIEW_QUERY,
      limit: 10,
      showRepo: true,
    });
  });
});

describe('normalizeQuery and normalizeTitle', () => {
  it('collapses whitespace in queries', () => {
    assert.equal(normalizeQuery('  is:open \n\t author:@me  '), 'is:open author:@me');
    assert.equal(normalizeQuery('   '), '');
  });

  it('trims titles and maps blank titles to null', () => {
    assert.equal(normalizeTitle('  Mine  '), 'Mine');
    assert.equal(normalizeTitle('  '), null);
  });
});

describe('isLimit', () => {
  it('accepts only the offered limits', () => {
    for (const value of [5, 10, 20, 50]) {
      assert.equal(isLimit(value), true);
    }
    for (const value of [0, 7, 100, '10', null]) {
      assert.equal(isLimit(value), false);
    }
  });
});

describe('parsePullRequestListConfig', () => {
  it('falls back to defaults for non objects', () => {
    for (const raw of [undefined, null, 'x', 3, []]) {
      assert.deepEqual(parsePullRequestListConfig(raw), defaultPullRequestListConfig());
    }
  });

  it('keeps valid fields', () => {
    const config: PullRequestListConfig = {
      title: 'Team',
      query: 'is:open org:acme',
      limit: 50,
      showRepo: false,
    };

    assert.deepEqual(parsePullRequestListConfig(config), config);
  });

  it('falls back per field', () => {
    assert.deepEqual(
      parsePullRequestListConfig({ title: 4, query: 'is:merged', limit: 11, showRepo: 'no' }),
      { title: null, query: 'is:merged', limit: 10, showRepo: true },
    );
    assert.deepEqual(
      parsePullRequestListConfig({ title: 'X', query: 5, limit: 5, showRepo: false }),
      { title: 'X', query: REVIEW_QUERY, limit: 5, showRepo: false },
    );
  });

  it('normalizes title and query', () => {
    assert.deepEqual(parsePullRequestListConfig({ title: '   ', query: '  a   b ' }), {
      title: null,
      query: 'a b',
      limit: 10,
      showRepo: true,
    });
    assert.equal(parsePullRequestListConfig({ query: '   ' }).query, REVIEW_QUERY);
  });
});

describe('findPreset', () => {
  it('matches preset queries regardless of whitespace', () => {
    assert.equal(findPreset(` is:open  archived:false   author:@me`)?.id, 'created');
    assert.equal(findPreset('is:open'), null);
  });
});

describe('pullRequestListTitle', () => {
  const base = defaultPullRequestListConfig();

  it('prefers the custom title', () => {
    assert.equal(pullRequestListTitle({ ...base, title: 'Mine' }), 'Mine');
  });

  it('uses the preset name for preset queries', () => {
    assert.equal(pullRequestListTitle(base), 'Review requested');
  });

  it('falls back to the query', () => {
    const config = { ...base, query: ' is:open  org:acme ' };

    assert.equal(pullRequestListTitle(config), 'is:open org:acme');
  });
});

describe('pullRequestSearchUrl', () => {
  it('links to the pull request search with is:pr prepended', () => {
    assert.equal(
      pullRequestSearchUrl('is:open review-requested:@me'),
      'https://github.com/pulls?q=is%3Apr%20is%3Aopen%20review-requested%3A%40me',
    );
  });

  it('encodes special characters', () => {
    assert.equal(
      pullRequestSearchUrl('label:"needs review" &x=1#y'),
      'https://github.com/pulls?q=is%3Apr%20label%3A%22needs%20review%22%20%26x%3D1%23y',
    );
  });
});
