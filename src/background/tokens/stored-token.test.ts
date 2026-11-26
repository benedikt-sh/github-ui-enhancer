import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  effectiveStatus,
  isPast,
  parseStoredTokens,
  serializeTokens,
  type StoredToken,
  toTokenInfo,
} from './stored-token.ts';

const NOW = new Date('2026-11-26T12:00:00Z');

const ENTRY: StoredToken = {
  id: 'a',
  secret: 'github_pat_secret1234',
  owner: 'octo-org',
  ownerSource: 'manual',
  status: 'valid',
  login: 'octocat',
  expiresAt: '2027-01-01T00:00:00Z',
  lastCheckedAt: '2026-11-25T08:00:00Z',
};

describe('parseStoredTokens', () => {
  it('round-trips serialized entries', () => {
    assert.deepEqual(parseStoredTokens(serializeTokens([ENTRY])), [ENTRY]);
  });

  it('returns an empty list for values that are not a token list', () => {
    for (const raw of [undefined, null, [], 'x', { version: 2, entries: [] }, { version: 1 }]) {
      assert.deepEqual(parseStoredTokens(raw), []);
    }
  });

  it('drops entries without id or secret and duplicates', () => {
    const raw = {
      version: 1,
      entries: [
        null,
        { secret: 'github_pat_x' },
        { id: 'b', secret: '' },
        ENTRY,
        { ...ENTRY, secret: 'github_pat_other' },
        { ...ENTRY, id: 'c' },
      ],
    };

    assert.deepEqual(parseStoredTokens(raw), [ENTRY]);
  });

  it('fills defaults for broken fields', () => {
    const raw = {
      version: 1,
      entries: [
        {
          id: 'a',
          secret: 'github_pat_x',
          owner: 42,
          ownerSource: 'manual',
          status: 'bogus',
          login: '',
          expiresAt: 'not a date',
          lastCheckedAt: 7,
        },
      ],
    };

    assert.deepEqual(parseStoredTokens(raw), [
      {
        id: 'a',
        secret: 'github_pat_x',
        owner: null,
        ownerSource: null,
        status: 'unchecked',
        login: null,
        expiresAt: null,
        lastCheckedAt: null,
      },
    ]);
  });

  it('treats an owner with unknown source as detected', () => {
    const [entry] = parseStoredTokens({
      version: 1,
      entries: [{ ...ENTRY, ownerSource: 'magic' }],
    });

    assert.equal(entry?.ownerSource, 'detected');
  });
});

describe('isPast', () => {
  it('compares against the given time', () => {
    assert.equal(isPast(null, NOW), false);
    assert.equal(isPast('2026-11-26T12:00:00Z', NOW), true);
    assert.equal(isPast('2026-11-26T12:00:01Z', NOW), false);
  });
});

describe('effectiveStatus', () => {
  it('reports valid tokens past their expiration as expired', () => {
    assert.equal(effectiveStatus(ENTRY, NOW), 'valid');
    assert.equal(effectiveStatus({ ...ENTRY, expiresAt: '2026-01-01T00:00:00Z' }, NOW), 'expired');
    assert.equal(effectiveStatus({ ...ENTRY, expiresAt: null }, NOW), 'valid');
  });

  it('keeps other statuses', () => {
    const entry = { ...ENTRY, status: 'invalid', expiresAt: '2026-01-01T00:00:00Z' } as const;

    assert.equal(effectiveStatus(entry, NOW), 'invalid');
  });
});

describe('toTokenInfo', () => {
  it('exposes everything except the secret', () => {
    const info = toTokenInfo(ENTRY, NOW);

    assert.deepEqual(info, {
      id: 'a',
      owner: 'octo-org',
      ownerSource: 'manual',
      status: 'valid',
      login: 'octocat',
      expiresAt: '2027-01-01T00:00:00Z',
      lastCheckedAt: '2026-11-25T08:00:00Z',
      hint: '1234',
    });
    assert.ok(!JSON.stringify(info).includes(ENTRY.secret));
  });
});
