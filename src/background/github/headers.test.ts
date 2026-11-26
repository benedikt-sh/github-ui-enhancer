import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseNextLink,
  parseRateLimit,
  parseSsoRequirement,
  parseTokenExpiration,
  retryAfterSeconds,
} from './headers.ts';

describe('parseRateLimit', () => {
  it('reads all rate limit headers', () => {
    const headers = new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4990',
      'x-ratelimit-reset': '1800000000',
      'x-ratelimit-used': '10',
      'x-ratelimit-resource': 'search',
    });

    assert.deepEqual(parseRateLimit(headers, 'core'), {
      resource: 'search',
      limit: 5000,
      remaining: 4990,
      used: 10,
      resetAt: '2027-01-15T08:00:00.000Z',
    });
  });

  it('falls back to the given resource and derives used', () => {
    const headers = new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '50',
      'x-ratelimit-reset': '0',
    });

    assert.deepEqual(parseRateLimit(headers, 'graphql'), {
      resource: 'graphql',
      limit: 60,
      remaining: 50,
      used: 10,
      resetAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('returns null if a required header is missing or malformed', () => {
    assert.equal(parseRateLimit(new Headers(), 'core'), null);
    const malformed = new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '-1',
      'x-ratelimit-reset': '0',
    });
    assert.equal(parseRateLimit(malformed, 'core'), null);
    const huge = new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '1',
      'x-ratelimit-reset': '9999999999999',
    });
    assert.equal(parseRateLimit(huge, 'core'), null);
  });
});

describe('parseTokenExpiration', () => {
  const expiration = (value: string) =>
    parseTokenExpiration(new Headers({ 'github-authentication-token-expiration': value }));

  it('converts the UTC format to ISO 8601', () => {
    assert.equal(expiration('2027-01-01 00:00:00 UTC'), '2027-01-01T00:00:00.000Z');
  });

  it('converts numeric offsets to UTC', () => {
    assert.equal(expiration('2027-01-01 00:00:00 -0800'), '2027-01-01T08:00:00.000Z');
  });

  it('returns null for absent, unknown or invalid values', () => {
    assert.equal(parseTokenExpiration(new Headers()), null);
    assert.equal(expiration('next year'), null);
    assert.equal(expiration('2027-13-01 00:00:00 UTC'), null);
  });
});

describe('parseNextLink', () => {
  const link = (value: string) => parseNextLink(new Headers({ link: value }));

  it('finds the next link among others', () => {
    const header =
      '<https://api.github.com/user/repos?page=1>; rel="prev", ' +
      '<https://api.github.com/user/repos?page=3>; rel="next", ' +
      '<https://api.github.com/user/repos?page=9>; rel="last"';
    assert.equal(link(header), 'https://api.github.com/user/repos?page=3');
  });

  it('keeps commas inside the URL and accepts unquoted and combined rel values', () => {
    assert.equal(link('<https://x/search?q=a,b&page=2>; rel=next'), 'https://x/search?q=a,b&page=2');
    assert.equal(link('<https://x/?page=2>; title="t"; rel="last next"'), 'https://x/?page=2');
  });

  it('returns null without header or next relation', () => {
    assert.equal(parseNextLink(new Headers()), null);
    assert.equal(link('<https://x/?page=1>; rel="prev"'), null);
    assert.equal(link('<https://x/?page=1>'), null);
  });
});

describe('parseSsoRequirement', () => {
  const sso = (value: string) => parseSsoRequirement(new Headers({ 'x-github-sso': value }));

  it('extracts the authorization URL', () => {
    const url = 'https://github.com/orgs/acme/sso?authorization_request=abc123';
    assert.deepEqual(sso(`required; url=${url}`), { url });
  });

  it('omits URLs that are invalid or not https', () => {
    assert.deepEqual(sso('required; url=javascript:alert(1)'), { url: undefined });
    assert.deepEqual(sso('required; url=::not a url'), { url: undefined });
    assert.deepEqual(sso('required'), { url: undefined });
  });

  it('ignores partial results and absent headers', () => {
    assert.equal(sso('partial-results; organizations=21955855,20582480'), null);
    assert.equal(parseSsoRequirement(new Headers()), null);
  });
});

describe('retryAfterSeconds', () => {
  const now = 1_800_000_000_000;

  it('prefers retry-after', () => {
    const headers = new Headers({ 'retry-after': '30', 'x-ratelimit-remaining': '0' });
    assert.equal(retryAfterSeconds(headers, now), 30);
  });

  it('uses the reset time when the bucket is empty', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1800000090',
    });
    assert.equal(retryAfterSeconds(headers, now - 500), 91);
    assert.equal(retryAfterSeconds(headers, now + 100_000), 0);
  });

  it('returns null if neither header applies', () => {
    assert.equal(retryAfterSeconds(new Headers(), now), null);
    const remaining = new Headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '1' });
    assert.equal(retryAfterSeconds(remaining, now), null);
    assert.equal(retryAfterSeconds(new Headers({ 'x-ratelimit-remaining': '0' }), now), null);
  });
});
