import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultRepoSearchConfig, parseRepoSearchConfig } from './repo-search-config.ts';

describe('defaultRepoSearchConfig', () => {
  it('searches all owners without archived repos', () => {
    assert.deepEqual(defaultRepoSearchConfig(), { owner: null, includeArchived: false });
  });

  it('returns a fresh object each time', () => {
    assert.notEqual(defaultRepoSearchConfig(), defaultRepoSearchConfig());
  });
});

describe('parseRepoSearchConfig', () => {
  it('keeps a valid config', () => {
    assert.deepEqual(parseRepoSearchConfig({ owner: 'acme', includeArchived: true }), {
      owner: 'acme',
      includeArchived: true,
    });
  });

  it('trims the owner', () => {
    assert.equal(parseRepoSearchConfig({ owner: '  acme ' }).owner, 'acme');
  });

  it('falls back to defaults for values that are not objects', () => {
    for (const raw of [undefined, null, 'acme', 42, ['acme']]) {
      assert.deepEqual(parseRepoSearchConfig(raw), defaultRepoSearchConfig());
    }
  });

  it('falls back per field for invalid parts', () => {
    assert.deepEqual(parseRepoSearchConfig({ owner: 42, includeArchived: 'yes' }), {
      owner: null,
      includeArchived: false,
    });
    assert.deepEqual(parseRepoSearchConfig({ owner: '   ', includeArchived: true }), {
      owner: null,
      includeArchived: true,
    });
  });
});
