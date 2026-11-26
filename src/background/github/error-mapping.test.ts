import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapGraphQLError, mapHttpError, redact } from './error-mapping.ts';

const NOW = 1_800_000_000_000;
const SSO_URL = 'https://github.com/orgs/acme/sso?authorization_request=abc';

function http(status: number, message: string | null, headers: Record<string, string> = {}) {
  return mapHttpError({
    status,
    headers: new Headers(headers),
    body: message === null ? null : { message, documentation_url: 'https://docs.github.com' },
    request: 'GET /user/repos',
    nowMillis: NOW,
  });
}

describe('mapHttpError', () => {
  it('maps 401 to unauthorized with a descriptive message', () => {
    assert.deepEqual(http(401, 'Bad credentials'), {
      kind: 'unauthorized',
      message: 'GitHub GET /user/repos failed with 401: Bad credentials',
      status: 401,
    });
  });

  it('maps 403 with an SSO header to sso_required with the authorization URL', () => {
    const info = http(403, 'Resource protected by organization SAML enforcement.', {
      'x-github-sso': `required; url=${SSO_URL}`,
    });
    assert.equal(info.kind, 'sso_required');
    assert.equal(info.actionUrl, SSO_URL);
    assert.equal(info.status, 403);
  });

  it('maps 403 with an SSO header without a usable URL to sso_required', () => {
    const info = http(403, null, { 'x-github-sso': 'required' });
    assert.equal(info.kind, 'sso_required');
    assert.equal('actionUrl' in info, false);
  });

  it('maps a missing permission to forbidden', () => {
    const info = http(403, 'Resource not accessible by personal access token');
    assert.equal(info.kind, 'forbidden');
    assert.match(info.message, /lacks a permission/);
  });

  it('maps other 403 responses to forbidden', () => {
    const info = http(403, 'Must have admin rights to Repository.');
    assert.deepEqual(info, {
      kind: 'forbidden',
      message: 'GitHub GET /user/repos failed with 403: Must have admin rights to Repository.',
      status: 403,
    });
  });

  it('maps rate limits with retry-after', () => {
    const info = http(403, 'You have exceeded a secondary rate limit', { 'retry-after': '42' });
    assert.equal(info.kind, 'rate_limited');
    assert.equal(info.retryAfter, 42);
    assert.equal(info.status, 403);
  });

  it('maps an empty primary bucket using the reset time', () => {
    const info = http(403, 'API rate limit exceeded', {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(NOW / 1000 + 120),
    });
    assert.equal(info.kind, 'rate_limited');
    assert.equal(info.retryAfter, 120);
  });

  it('maps 429 and rate limit messages without timing headers to a one minute wait', () => {
    assert.equal(http(429, null).retryAfter, 60);
    const info = http(403, 'You have exceeded a secondary rate limit.');
    assert.equal(info.kind, 'rate_limited');
    assert.equal(info.retryAfter, 60);
  });

  it('detects tokens waiting for organization approval', () => {
    const pending = http(403, 'Token is pending approval by the organization');
    assert.equal(pending.kind, 'pending_approval');
    assert.equal(http(401, 'This token has not been approved yet').kind, 'pending_approval');
  });

  it('maps 404 and 410 to not_found', () => {
    assert.equal(http(404, 'Not Found').kind, 'not_found');
    assert.equal(http(410, 'Gone').kind, 'not_found');
  });

  it('maps validation statuses to invalid_request', () => {
    assert.equal(http(400, 'Problems parsing JSON').kind, 'invalid_request');
    assert.equal(http(409, 'Git Repository is empty.').kind, 'invalid_request');
    assert.equal(http(422, 'Validation Failed').kind, 'invalid_request');
  });

  it('maps server errors and unknown statuses to internal', () => {
    assert.deepEqual(http(502, null), {
      kind: 'internal',
      message: 'GitHub GET /user/repos failed with 502: no message',
      status: 502,
    });
    assert.equal(http(418, 'teapot').kind, 'internal');
  });

  it('truncates long messages', () => {
    const info = http(500, 'x'.repeat(1000));
    assert.ok(info.message.length < 400);
    assert.ok(info.message.endsWith('...'));
  });
});

describe('mapGraphQLError', () => {
  const graphql = (error: unknown, headers: Record<string, string> = {}) =>
    mapGraphQLError(error, new Headers(headers), NOW);

  it('maps FORBIDDEN, NOT_FOUND and UNAUTHORIZED with their path', () => {
    assert.deepEqual(graphql({ type: 'NOT_FOUND', message: 'Could not resolve', path: ['repo'] }), {
      path: ['repo'],
      error: { kind: 'not_found', message: 'GitHub GraphQL error NOT_FOUND: Could not resolve' },
    });
    assert.equal(graphql({ type: 'FORBIDDEN', message: 'no' }).error.kind, 'forbidden');
    assert.equal(graphql({ type: 'UNAUTHORIZED', message: 'no' }).error.kind, 'unauthorized');
  });

  it('maps SAML enforcement to sso_required, with the URL if GitHub sent one', () => {
    const message = 'Resource protected by organization SAML enforcement. You must grant access.';
    assert.deepEqual(graphql({ type: 'FORBIDDEN', message, path: ['a', 0, 'b'] }).error, {
      kind: 'sso_required',
      message: `GitHub GraphQL error FORBIDDEN: ${message}`,
    });
    const withUrl = graphql(
      { type: 'FORBIDDEN', message },
      { 'x-github-sso': `required; url=${SSO_URL}` },
    );
    assert.equal(withUrl.error.actionUrl, SSO_URL);
  });

  it('maps RATE_LIMITED using the reset time or a default', () => {
    const headers = {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(NOW / 1000 + 30),
    };
    const limited = { type: 'RATE_LIMITED', message: 'API rate limit exceeded' };
    assert.equal(graphql(limited, headers).error.retryAfter, 30);
    assert.equal(graphql(limited).error.retryAfter, 60);
    const untyped = graphql({ message: 'API rate limit exceeded for user' });
    assert.equal(untyped.error.kind, 'rate_limited');
  });

  it('detects pending approval only for FORBIDDEN errors', () => {
    const message = 'Token is pending approval by the organization';
    assert.equal(graphql({ type: 'FORBIDDEN', message }).error.kind, 'pending_approval');
    const notFound = graphql({ type: 'NOT_FOUND', message: "repo 'pending approval x'" });
    assert.equal(notFound.error.kind, 'not_found');
  });

  it('maps untyped errors to invalid_request and unknown types to internal', () => {
    const untyped = graphql({ message: "Field 'nope' doesn't exist", extensions: { code: 'x' } });
    assert.equal(untyped.error.kind, 'invalid_request');
    assert.equal(graphql({ type: 'SERVICE_UNAVAILABLE', message: 'later' }).error.kind, 'internal');
  });

  it('tolerates malformed errors and paths', () => {
    assert.deepEqual(graphql('boom'), {
      path: [],
      error: { kind: 'invalid_request', message: 'GitHub GraphQL error: no message' },
    });
    assert.deepEqual(graphql({ path: ['a', null, 1, {}] }).path, ['a', 1]);
  });
});

describe('redact', () => {
  it('replaces every occurrence of the token', () => {
    const info = { kind: 'network', message: 'bad tok_1 and tok_1' } as const;
    assert.deepEqual(redact(info, 'tok_1'), {
      kind: 'network',
      message: 'bad [redacted] and [redacted]',
    });
  });

  it('returns the info unchanged without a match or an empty token', () => {
    const info = { kind: 'network', message: 'offline' } as const;
    assert.equal(redact(info, 'tok_1'), info);
    assert.equal(redact(info, ''), info);
  });
});
