import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFetchFake } from '../../../test/fakes/fetch.ts';
import { ApiError, type ApiErrorKind } from '../../shared/errors.ts';
import { createGitHubClient } from '../github/client.ts';
import type { GitHubClient } from '../github/types.ts';
import { createTokenProbe } from './token-probe.ts';

const API = 'https://api.github.com';
const SECRET = 'github_pat_probe0000';

function setup() {
  const fake = createFetchFake();
  const probe = createTokenProbe(createGitHubClient({ fetch: fake.fetch }));
  return { fake, probe };
}

function isKind(kind: ApiErrorKind) {
  return (error: unknown) => error instanceof ApiError && error.info.kind === kind;
}

describe('createTokenProbe', () => {
  it('reads login and expiration from GET /user', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user`, {
      headers: { 'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC' },
      body: { login: 'octocat', id: 1 },
    });

    assert.deepEqual(await probe.inspect(SECRET), {
      login: 'octocat',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    assert.equal(fake.requests[0]?.headers.get('authorization'), `Bearer ${SECRET}`);
  });

  it('reports a missing expiration as null', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user`, { body: { login: 'octocat' } });

    assert.deepEqual(await probe.inspect(SECRET), { login: 'octocat', expiresAt: null });
  });

  it('rejects a user without login', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user`, { body: { login: '' } });

    await assert.rejects(probe.inspect(SECRET), isKind('invalid_response'));
  });

  it('passes API errors through', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user`, { status: 401, body: { message: 'Bad credentials' } });

    await assert.rejects(probe.inspect(SECRET), isKind('unauthorized'));
  });

  it('lists the distinct owners of the first repository page', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user/repos`, {
      headers: { link: `<${API}/user/repos?per_page=100&page=2>; rel="next"` },
      body: [
        { owner: { login: 'Acme' } },
        { owner: { login: 'acme' } },
        { owner: { login: 'octocat' } },
        { owner: null },
        { owner: { login: '' } },
        'garbage',
      ],
    });

    assert.deepEqual(await probe.repositoryOwners(SECRET), ['Acme', 'octocat']);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0]?.url, `${API}/user/repos?per_page=100`);
  });

  it('rejects a repository answer that is not a list', async () => {
    const { fake, probe } = setup();
    fake.on(`${API}/user/repos`, { body: { message: 'odd' } });

    await assert.rejects(probe.repositoryOwners(SECRET), isKind('invalid_response'));
  });

  it('rejects an unexpected "not modified" answer', async () => {
    const meta = { rateLimit: null, tokenExpiresAt: null };
    const client: GitHubClient = {
      restGet: async () => ({ kind: 'not_modified', etag: 'x', meta }),
      restGetPages: () => Promise.reject(new Error('unused')),
      graphql: () => Promise.reject(new Error('unused')),
      rateLimit: () => null,
    };
    const probe = createTokenProbe(client);

    await assert.rejects(probe.inspect(SECRET), isKind('invalid_response'));
    await assert.rejects(probe.repositoryOwners(SECRET), isKind('invalid_response'));
  });
});
