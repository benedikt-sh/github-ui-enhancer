import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collectOwners } from './owners.ts';
import { repo } from './repo-search.fixture.ts';

describe('collectOwners', () => {
  it('returns nothing for an empty index', () => {
    assert.deepEqual(collectOwners([]), []);
  });

  it('dedupes case-insensitively and sorts by name', () => {
    const repos = [repo('zeta/a'), repo('Acme/b'), repo('acme/c'), repo('beta/d')];

    assert.deepEqual(collectOwners(repos), ['Acme', 'beta', 'zeta']);
  });

  it('keeps the selected owner even without repos', () => {
    assert.deepEqual(collectOwners([repo('acme/app')], 'gone'), ['acme', 'gone']);
  });

  it('prefers the spelling of the selected owner', () => {
    assert.deepEqual(collectOwners([repo('acme/app')], 'ACME'), ['ACME']);
  });
});
