import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ASSIGNED_QUERY,
  CREATED_QUERY,
  ISSUE_LIST_PRESETS,
  SUBSCRIPTIONS_URL,
  automaticTitle,
  defaultIssueListConfig,
  issueListTitle,
  matchingPreset,
  normalizeQuery,
  parseIssueListConfig,
  viewAllUrl,
} from './config.ts';
import type { IssueListConfig } from './config.ts';

function config(overrides: Partial<IssueListConfig> = {}): IssueListConfig {
  return { ...defaultIssueListConfig(), ...overrides };
}

describe('defaultIssueListConfig', () => {
  it('equals the "Assigned to me" preset', () => {
    assert.deepEqual(defaultIssueListConfig(), ISSUE_LIST_PRESETS[0]?.config);
    assert.equal(ISSUE_LIST_PRESETS[0]?.title, 'Assigned to me');
  });

  it('returns a fresh object each time', () => {
    assert.notEqual(defaultIssueListConfig(), defaultIssueListConfig());
  });
});

describe('ISSUE_LIST_PRESETS', () => {
  it('offers assigned, watched and created issues', () => {
    assert.deepEqual(
      ISSUE_LIST_PRESETS.map((preset) => [preset.id, preset.config.source, preset.config.query]),
      [
        ['assigned', 'search', ASSIGNED_QUERY],
        ['watched', 'subscribed', ''],
        ['created', 'search', CREATED_QUERY],
      ],
    );
  });

  it('keeps every preset stable through parseConfig', () => {
    for (const preset of ISSUE_LIST_PRESETS) {
      assert.deepEqual(parseIssueListConfig(preset.config), preset.config);
    }
  });
});

describe('parseIssueListConfig', () => {
  it('falls back to the default for anything that is not an object', () => {
    for (const raw of [undefined, null, 'x', 42, [], true]) {
      assert.deepEqual(parseIssueListConfig(raw), defaultIssueListConfig());
    }
  });

  it('accepts a complete valid config', () => {
    const raw = {
      source: 'subscribed',
      title: 'My issues',
      query: 'label:bug',
      limit: 50,
      showRepo: false,
    };
    assert.deepEqual(parseIssueListConfig(raw), raw);
  });

  it('falls back per field', () => {
    assert.deepEqual(
      parseIssueListConfig({
        source: 'mentioned',
        title: 7,
        query: 'repo:a/b is:open',
        limit: 7,
        showRepo: 'yes',
      }),
      {
        source: 'search',
        title: null,
        query: 'repo:a/b is:open',
        limit: 10,
        showRepo: true,
      },
    );
  });

  it('accepts all allowed limits', () => {
    for (const limit of [5, 10, 20, 50]) {
      assert.equal(parseIssueListConfig({ limit }).limit, limit);
    }
    assert.equal(parseIssueListConfig({ limit: '20' }).limit, 10);
  });

  it('trims the title and treats a blank title as missing', () => {
    assert.equal(parseIssueListConfig({ title: '  Bugs  ' }).title, 'Bugs');
    assert.equal(parseIssueListConfig({ title: '   ' }).title, null);
  });

  it('normalizes the query and uses the default for a blank search query', () => {
    const query = parseIssueListConfig({ query: '  is:open   label:bug ' }).query;
    assert.equal(query, 'is:open label:bug');
    assert.equal(parseIssueListConfig({ query: '  ' }).query, ASSIGNED_QUERY);
    assert.equal(parseIssueListConfig({ query: 3 }).query, ASSIGNED_QUERY);
  });

  it('allows an empty query for the subscribed source', () => {
    assert.equal(parseIssueListConfig({ source: 'subscribed' }).query, '');
    assert.equal(parseIssueListConfig({ source: 'subscribed', query: ' a  b ' }).query, 'a b');
  });
});

describe('normalizeQuery', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeQuery('\t a \n\n b  '), 'a b');
  });
});

describe('matchingPreset', () => {
  it('matches search presets by query regardless of whitespace and display options', () => {
    const match = matchingPreset(
      config({ query: ` ${CREATED_QUERY.replaceAll(' ', '  ')} `, limit: 50, showRepo: false }),
    );
    assert.equal(match?.id, 'created');
  });

  it('matches the subscribed preset by source only', () => {
    assert.equal(matchingPreset(config({ source: 'subscribed', query: 'ignored' }))?.id, 'watched');
  });

  it('returns null for custom queries', () => {
    assert.equal(matchingPreset(config({ query: 'label:bug' })), null);
  });
});

describe('titles', () => {
  it('prefers the custom title', () => {
    assert.equal(issueListTitle(config({ title: 'Mine' })), 'Mine');
  });

  it('uses the preset name, then the query', () => {
    assert.equal(issueListTitle(config()), 'Assigned to me');
    assert.equal(issueListTitle(config({ query: CREATED_QUERY })), 'Created by me');
    assert.equal(issueListTitle(config({ query: ' label:bug  is:open' })), 'label:bug is:open');
  });

  it('names the subscribed source "Watched issues"', () => {
    assert.equal(issueListTitle(config({ source: 'subscribed', query: '' })), 'Watched issues');
  });

  it('ignores the custom title for the automatic title', () => {
    assert.equal(automaticTitle(config({ title: 'Mine' })), 'Assigned to me');
  });
});

describe('viewAllUrl', () => {
  it('links the issue search with is:issue prepended', () => {
    assert.equal(
      viewAllUrl(config({ query: 'is:open label:"good first issue"' })),
      'https://github.com/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22',
    );
  });

  it('links the subscriptions page for the subscribed source', () => {
    assert.equal(viewAllUrl(config({ source: 'subscribed' })), SUBSCRIPTIONS_URL);
  });
});
