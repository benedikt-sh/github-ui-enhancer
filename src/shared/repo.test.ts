import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRepoFullName, repoFullName, sameOwner } from './repo.ts';

describe('repo helpers', () => {
  it('builds the full name', () => {
    assert.equal(repoFullName({ owner: 'octo', name: 'hello.world' }), 'octo/hello.world');
  });

  it('parses valid full names and trims whitespace', () => {
    assert.deepEqual(parseRepoFullName(' octo-org/repo_1.x '), { owner: 'octo-org', name: 'repo_1.x' });
  });

  it('rejects malformed full names', () => {
    for (const value of ['', 'octo', 'a/b/c', 'octo/', '/repo', 'oc to/repo', 'octo/re po']) {
      assert.equal(parseRepoFullName(value), null, value);
    }
  });

  it('compares owners case-insensitively', () => {
    assert.equal(sameOwner('Octo-Org', 'octo-org'), true);
    assert.equal(sameOwner('octo', 'octa'), false);
  });
});
