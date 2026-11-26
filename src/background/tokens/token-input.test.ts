import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError } from '../../shared/errors.ts';
import { normalizeOwner, normalizeSecret } from './token-input.ts';

const FINE_GRAINED = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789';

function assertInvalidRequest(action: () => unknown, pattern: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.info.kind, 'invalid_request');
    assert.match(error.message, pattern);
    return true;
  });
}

describe('normalizeSecret', () => {
  it('accepts fine-grained tokens and trims surrounding whitespace', () => {
    assert.equal(normalizeSecret(`  ${FINE_GRAINED}\n`), FINE_GRAINED);
  });

  it('rejects empty input', () => {
    assertInvalidRequest(() => normalizeSecret('   '), /empty/);
  });

  it('rejects classic tokens with prefix', () => {
    const classic = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    assertInvalidRequest(() => normalizeSecret(classic), /Classic/);
  });

  it('rejects legacy classic tokens made of 40 hex digits', () => {
    const legacy = '0123456789abcdef0123456789abcdef01234567';
    assertInvalidRequest(() => normalizeSecret(legacy), /Classic/);
  });

  it('rejects other token types and malformed fine-grained tokens', () => {
    for (const input of ['gho_abc', 'ghs_abc', 'github_pat_', 'github_pat_abc def', 'hello']) {
      assertInvalidRequest(() => normalizeSecret(input), /not a fine-grained/);
    }
  });

  it('never echoes the token in the error message', () => {
    const secret = 'ghu_verysecretvalue';
    assert.throws(
      () => normalizeSecret(secret),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  });
});

describe('normalizeOwner', () => {
  it('returns null for missing or blank input', () => {
    assert.equal(normalizeOwner(undefined), null);
    assert.equal(normalizeOwner(null), null);
    assert.equal(normalizeOwner('  '), null);
  });

  it('trims valid logins', () => {
    assert.equal(normalizeOwner(' my-org '), 'my-org');
    assert.equal(normalizeOwner('Octocat'), 'Octocat');
  });

  it('rejects invalid logins', () => {
    for (const input of ['-org', 'my org', 'org/repo', 'a'.repeat(40)]) {
      assertInvalidRequest(() => normalizeOwner(input), /not a valid GitHub/);
    }
  });
});
