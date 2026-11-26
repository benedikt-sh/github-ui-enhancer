import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, type ApiErrorKind } from '../../shared/errors.ts';
import { createFetchFake, type FetchFake } from '../../../test/fakes/fetch.ts';
import { createGitHubClient, DEFAULT_MAX_PAGES, GITHUB_API_VERSION } from './client.ts';

const TOKEN = 'github_pat_11AAAAAAA0secretvalue';
const API = 'https://api.github.com';
const NOW = 1_800_000_000_000;
const RESET = String(NOW / 1000 + 600);

function setup(): { fake: FetchFake; client: ReturnType<typeof createGitHubClient> } {
  const fake = createFetchFake();
  return { fake, client: createGitHubClient({ fetch: fake.fetch, now: () => NOW }) };
}

function rateHeaders(resource: string, remaining: number, reset = RESET): Record<string, string> {
  return {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': reset,
    'x-ratelimit-used': String(5000 - remaining),
    'x-ratelimit-resource': resource,
  };
}

async function rejectsWith(promise: Promise<unknown>, kind: ApiErrorKind): Promise<ApiError> {
  let caught: unknown;
  await assert.rejects(promise, (error: unknown) => {
    caught = error;
    return error instanceof ApiError && error.info.kind === kind;
  });
  assert.ok(caught instanceof ApiError);
  assert.equal(caught.message.includes(TOKEN), false, 'message must not contain the token');
  return caught;
}

describe('restGet', () => {
  it('sends an authenticated GET with the API headers and query', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user/repos`, { body: [] });

    await client.restGet(TOKEN, '/user/repos', {
      query: { per_page: 100, archived: false, sort: 'pushed', skipped: undefined },
    });

    const [request] = fake.requests;
    assert.equal(request?.method, 'GET');
    assert.equal(request?.url, `${API}/user/repos?per_page=100&archived=false&sort=pushed`);
    assert.equal(request?.headers.get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(request?.headers.get('accept'), 'application/vnd.github+json');
    assert.equal(request?.headers.get('x-github-api-version'), GITHUB_API_VERSION);
    assert.equal(request?.headers.has('if-none-match'), false);
    assert.equal(request?.body, null);
  });

  it('keeps a query string that is part of the path', async () => {
    const { fake, client } = setup();
    fake.on(() => true, { body: {} });

    await client.restGet(TOKEN, '/issues?filter=subscribed', { query: { state: 'open' } });

    assert.equal(fake.requests[0]?.url, `${API}/issues?filter=subscribed&state=open`);
  });

  it('returns data, etag and metadata', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, {
      headers: {
        etag: 'W/"abc"',
        'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC',
        ...rateHeaders('core', 4999),
      },
      body: { login: 'octocat' },
    });

    const result = await client.restGet(TOKEN, '/user');

    assert.deepEqual(result, {
      kind: 'ok',
      data: { login: 'octocat' },
      etag: 'W/"abc"',
      meta: {
        rateLimit: {
          resource: 'core',
          limit: 5000,
          remaining: 4999,
          used: 1,
          resetAt: new Date(Number(RESET) * 1000).toISOString(),
        },
        tokenExpiresAt: '2027-01-01T00:00:00.000Z',
      },
    });
  });

  it('returns null data and metadata for empty bodies', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user/starred/a/b`, { status: 204 });

    assert.deepEqual(await client.restGet(TOKEN, '/user/starred/a/b'), {
      kind: 'ok',
      data: null,
      etag: null,
      meta: { rateLimit: null, tokenExpiresAt: null },
    });
  });

  it('sends the etag and reports not modified', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 304, headers: { etag: '"new"', ...rateHeaders('core', 10) } });

    const result = await client.restGet(TOKEN, '/user', { etag: '"old"' });

    assert.equal(fake.requests[0]?.headers.get('if-none-match'), '"old"');
    assert.equal(result.kind, 'not_modified');
    assert.equal(result.etag, '"new"');
    assert.equal(result.meta.rateLimit?.remaining, 10);
  });

  it('keeps the sent etag if a 304 carries none', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 304 });

    const result = await client.restGet(TOKEN, '/user', { etag: '"old"' });

    assert.deepEqual(result, {
      kind: 'not_modified',
      etag: '"old"',
      meta: { rateLimit: null, tokenExpiresAt: null },
    });
  });

  it('returns fresh data if the etag no longer matches', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { headers: { etag: '"new"' }, body: { login: 'x' } });

    const result = await client.restGet(TOKEN, '/user', { etag: '"old"' });

    assert.equal(result.kind, 'ok');
    assert.equal(result.etag, '"new"');
  });

  it('refuses a 304 to an unconditional request', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 304 });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'invalid_response');
    assert.equal(error.info.status, 304);
  });

  it('refuses invalid JSON in a successful response', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { headers: { 'content-type': 'application/json' }, body: '{oops' });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'invalid_response');
    assert.equal(error.info.status, 200);
  });

  it('maps error statuses even if the body is not JSON', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 502, body: '<html>Bad gateway</html>' });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'internal');
    assert.equal(error.info.status, 502);
    assert.match(error.message, /GET \/user failed with 502/);
  });

  it('maps 401 to unauthorized', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 401, body: { message: 'Bad credentials' } });

    await rejectsWith(client.restGet(TOKEN, '/user'), 'unauthorized');
  });

  it('maps SSO, permission, rate limit and not found errors', async () => {
    const { fake, client } = setup();
    const ssoUrl = 'https://github.com/orgs/acme/sso?authorization_request=abc';
    fake
      .on(`${API}/sso`, { status: 403, headers: { 'x-github-sso': `required; url=${ssoUrl}` } })
      .on(`${API}/perm`, {
        status: 403,
        body: { message: 'Resource not accessible by personal access token' },
      })
      .on(`${API}/rate`, { status: 403, headers: rateHeaders('core', 0) })
      .on(`${API}/gone`, { status: 404, body: { message: 'Not Found' } });

    const sso = await rejectsWith(client.restGet(TOKEN, '/sso'), 'sso_required');
    assert.equal(sso.info.actionUrl, ssoUrl);
    await rejectsWith(client.restGet(TOKEN, '/perm'), 'forbidden');
    const rate = await rejectsWith(client.restGet(TOKEN, '/rate'), 'rate_limited');
    assert.equal(rate.info.retryAfter, 600);
    await rejectsWith(client.restGet(TOKEN, '/gone'), 'not_found');
  });

  it('redacts the token if GitHub echoes it', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/user`, { status: 401, body: { message: `Token ${TOKEN} is bad` } });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'unauthorized');
    assert.match(error.message, /Token \[redacted\] is bad/);
  });

  it('maps fetch failures to network errors without the token', async () => {
    const { fake, client } = setup();
    fake.failNetwork(`${API}/user`);

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'network');
    assert.match(error.message, /Failed to fetch/);

    const echoing = createGitHubClient({
      fetch: () => Promise.reject(new Error(`cannot send ${TOKEN}`)),
    });
    await rejectsWith(echoing.restGet(TOKEN, '/user'), 'network');
    const throwingValue = createGitHubClient({ fetch: () => Promise.reject('offline') });
    const valueError = await rejectsWith(throwingValue.restGet(TOKEN, '/user'), 'network');
    assert.match(valueError.message, /offline/);
  });

  it('maps failures while reading the body to network errors', async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const client = createGitHubClient({ fetch: async () => new Response(broken) });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'network');
    assert.match(error.message, /connection reset/);
  });

  it('refuses paths outside the API root without sending a request', async () => {
    const { fake, client } = setup();

    for (const path of ['user', 'https://evil.example/x', '//evil.example/x', '/\\evil.example']) {
      await rejectsWith(client.restGet(TOKEN, path), 'invalid_request');
    }
    assert.equal(fake.requests.length, 0);
  });

  it('refuses malformed tokens without echoing them', async () => {
    const { fake, client } = setup();

    for (const token of ['', 'abc def', 'abc\nInjected: 1', 'tökén']) {
      const error = await rejectsWith(client.restGet(token, '/user'), 'invalid_request');
      if (token !== '') {
        assert.equal(error.message.includes(token), false);
      }
    }
    assert.equal(fake.requests.length, 0);
  });
});

describe('abort handling', () => {
  function hangingFetch(): typeof fetch {
    return (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('fetch saw abort')));
      });
  }

  it('does not send a request with an already aborted signal', async () => {
    const { fake, client } = setup();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(client.restGet(TOKEN, '/user', { signal: controller.signal }), {
      name: 'AbortError',
    });
    assert.equal(fake.requests.length, 0);
  });

  it('rethrows the abort reason instead of a network error', async () => {
    const client = createGitHubClient({ fetch: hangingFetch() });
    const controller = new AbortController();
    const reason = new Error('user navigated away');

    const pending = client.restGet(TOKEN, '/user', { signal: controller.signal });
    controller.abort(reason);

    await assert.rejects(pending, (error: unknown) => error === reason);
  });

  it('passes the signal to fetch for graphql and pagination', async () => {
    const client = createGitHubClient({ fetch: hangingFetch() });
    const controller = new AbortController();

    const query = client.graphql(TOKEN, '{ viewer { login } }', {}, { signal: controller.signal });
    const pages = client.restGetPages(TOKEN, '/user/repos', { signal: controller.signal });
    controller.abort();

    await assert.rejects(query, { name: 'AbortError' });
    await assert.rejects(pages, { name: 'AbortError' });
  });
});

describe('restGetPages', () => {
  function pageRoutes(fake: FetchFake, total: number): void {
    for (let page = 1; page <= total; page += 1) {
      const nextUrl = `${API}/user/repos?per_page=2&page=${page + 1}`;
      const next = page < total ? `<${nextUrl}>; rel="next"` : '';
      fake.on(
        (request) =>
          request.url === `${API}/user/repos?per_page=2` + (page === 1 ? '' : `&page=${page}`),
        { headers: { link: next, ...rateHeaders('core', 100 - page) }, body: [page] },
      );
    }
  }

  it('follows next links and collects every page', async () => {
    const { fake, client } = setup();
    pageRoutes(fake, 3);

    const result = await client.restGetPages(TOKEN, '/user/repos', { query: { per_page: 2 } });

    assert.deepEqual(result.pages, [[1], [2], [3]]);
    assert.equal(result.truncated, false);
    assert.equal(result.meta.rateLimit?.remaining, 97);
    assert.ok(fake.requests.every((request) => request.headers.get('authorization') !== null));
  });

  it('stops at maxPages and reports truncation', async () => {
    const { fake, client } = setup();
    pageRoutes(fake, 5);

    const result = await client.restGetPages(TOKEN, '/user/repos', {
      query: { per_page: 2 },
      maxPages: 2,
    });

    assert.deepEqual(result.pages, [[1], [2]]);
    assert.equal(result.truncated, true);
    assert.equal(fake.requests.length, 2);
  });

  it('uses a default page limit', async () => {
    const { fake, client } = setup();
    pageRoutes(fake, DEFAULT_MAX_PAGES + 2);

    const result = await client.restGetPages(TOKEN, '/user/repos', { query: { per_page: 2 } });

    assert.equal(result.pages.length, DEFAULT_MAX_PAGES);
    assert.equal(result.truncated, true);
  });

  it('refuses invalid page limits', async () => {
    const { fake, client } = setup();

    await rejectsWith(
      client.restGetPages(TOKEN, '/user/repos', { maxPages: 0 }),
      'invalid_request',
    );
    await rejectsWith(
      client.restGetPages(TOKEN, '/user/repos', { maxPages: 1.5 }),
      'invalid_request',
    );
    assert.equal(fake.requests.length, 0);
  });

  it('refuses to follow links to other hosts or unparsable links', async () => {
    const { fake, client } = setup();
    fake
      .on(`${API}/foreign`, { headers: { link: '<https://evil.example/x>; rel="next"' }, body: [] })
      .on(`${API}/broken`, { headers: { link: '<not a url>; rel="next"' }, body: [] });

    await rejectsWith(client.restGetPages(TOKEN, '/foreign'), 'invalid_response');
    await rejectsWith(client.restGetPages(TOKEN, '/broken'), 'invalid_response');
    assert.equal(fake.requests.length, 2);
  });

  it('propagates errors of later pages', async () => {
    const { fake, client } = setup();
    fake
      .on(`${API}/user/repos`, {
        headers: { link: `<${API}/user/repos?page=2>; rel="next"` },
        body: [],
      })
      .on(`${API}/user/repos?page=2`, { status: 500 });

    await rejectsWith(client.restGetPages(TOKEN, '/user/repos'), 'internal');
  });
});

describe('graphql', () => {
  const QUERY = 'query ($q: String!) { search(query: $q, type: ISSUE, first: 5) { issueCount } }';

  it('posts the query and variables and returns the data', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/graphql`, {
      headers: rateHeaders('graphql', 4990),
      body: { data: { search: { issueCount: 3 } } },
    });

    const result = await client.graphql(TOKEN, QUERY, { q: 'is:pr' });

    const [request] = fake.requests;
    assert.equal(request?.method, 'POST');
    assert.equal(request?.headers.get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(request?.headers.get('content-type'), 'application/json');
    assert.equal(request?.headers.get('x-github-api-version'), GITHUB_API_VERSION);
    assert.deepEqual(JSON.parse(request?.body ?? ''), { query: QUERY, variables: { q: 'is:pr' } });
    assert.deepEqual(result.data, { search: { issueCount: 3 } });
    assert.deepEqual(result.errors, []);
    assert.equal(result.meta.rateLimit?.resource, 'graphql');
  });

  it('sends empty variables by default', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/graphql`, { body: { data: { viewer: { login: 'x' } } } });

    await client.graphql(TOKEN, '{ viewer { login } }');

    assert.deepEqual(JSON.parse(fake.requests[0]?.body ?? ''), {
      query: '{ viewer { login } }',
      variables: {},
    });
  });

  it('blocks mutations before sending anything', async () => {
    const { fake, client } = setup();

    await rejectsWith(
      client.graphql(TOKEN, 'mutation { addStar(input: { starrableId: "x" }) { id } }'),
      'blocked_write',
    );
    assert.equal(fake.requests.length, 0);
  });

  it('refuses variables that cannot be serialized', async () => {
    const { fake, client } = setup();

    await rejectsWith(client.graphql(TOKEN, QUERY, { q: 1n }), 'invalid_request');
    assert.equal(fake.requests.length, 0);
  });

  it('returns partial data together with mapped errors', async () => {
    const { fake, client } = setup();
    const saml = `Resource protected by organization SAML enforcement. Token ${TOKEN}`;
    fake.on(`${API}/graphql`, {
      body: {
        data: { a: { issueCount: 1 }, b: null },
        errors: [{ type: 'FORBIDDEN', message: saml, path: ['b'] }],
      },
    });

    const result = await client.graphql(TOKEN, QUERY, { q: 'x' });

    assert.deepEqual(result.data, { a: { issueCount: 1 }, b: null });
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.errors[0]?.path, ['b']);
    assert.equal(result.errors[0]?.error.kind, 'sso_required');
    assert.equal(result.errors[0]?.error.message.includes(TOKEN), false);
  });

  it('returns null fields without errors as data', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/graphql`, { body: { data: { repository: null }, errors: 'ignored' } });

    const result = await client.graphql(TOKEN, QUERY);

    assert.deepEqual(result.data, { repository: null });
    assert.deepEqual(result.errors, []);
  });

  it('throws the first error if there is no usable data', async () => {
    const { fake, client } = setup();
    fake
      .once(`${API}/graphql`, {
        body: {
          data: null,
          errors: [
            { type: 'NOT_FOUND', message: 'Could not resolve' },
            { type: 'FORBIDDEN', message: 'no' },
          ],
        },
      })
      .once(`${API}/graphql`, {
        body: { data: { a: null }, errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] },
      })
      .once(`${API}/graphql`, { body: { errors: [{ message: "Field 'x' doesn't exist" }] } });

    await rejectsWith(client.graphql(TOKEN, QUERY), 'not_found');
    const limited = await rejectsWith(client.graphql(TOKEN, QUERY), 'rate_limited');
    assert.equal(limited.info.retryAfter, 60);
    await rejectsWith(client.graphql(TOKEN, QUERY), 'invalid_request');
  });

  it('refuses responses without data or errors and non-object responses', async () => {
    const { fake, client } = setup();
    fake.once(`${API}/graphql`, { body: {} }).once(`${API}/graphql`, { body: [1, 2] });

    await rejectsWith(client.graphql(TOKEN, QUERY), 'invalid_response');
    await rejectsWith(client.graphql(TOKEN, QUERY), 'invalid_response');
  });

  it('maps HTTP errors and records the graphql bucket', async () => {
    const { fake, client } = setup();
    fake.on(`${API}/graphql`, {
      status: 403,
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': RESET,
      },
      body: { message: 'API rate limit exceeded' },
    });

    const error = await rejectsWith(client.graphql(TOKEN, QUERY), 'rate_limited');
    assert.equal(error.info.retryAfter, 600);
    assert.equal(client.rateLimit('graphql')?.remaining, 0);
  });
});

describe('rateLimit', () => {
  it('tracks the latest snapshot per resource', async () => {
    const { fake, client } = setup();
    fake
      .once(`${API}/a`, { headers: rateHeaders('core', 50), body: {} })
      .once(`${API}/a`, { headers: rateHeaders('core', 60), body: {} })
      .once(`${API}/a`, {
        headers: rateHeaders('core', 4999, String(Number(RESET) + 3600)),
        body: {},
      })
      .once(`${API}/b`, { headers: rateHeaders('search', 29), body: {} });

    assert.equal(client.rateLimit('core'), null);
    await client.restGet(TOKEN, '/a');
    assert.equal(client.rateLimit('core')?.remaining, 50);

    await client.restGet(TOKEN, '/a');
    assert.equal(client.rateLimit('core')?.remaining, 50, 'stale snapshot of the same window');

    await client.restGet(TOKEN, '/a');
    assert.equal(client.rateLimit('core')?.remaining, 4999, 'new window replaces the old one');

    await client.restGet(TOKEN, '/b');
    assert.equal(client.rateLimit('search')?.remaining, 29);
    assert.equal(client.rateLimit('core')?.remaining, 4999);
  });

  it('defaults the clock to Date.now', async () => {
    const fake = createFetchFake();
    const client = createGitHubClient({ fetch: fake.fetch });
    const reset = String(Math.floor(Date.now() / 1000) + 3600);
    fake.on(`${API}/user`, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
    });

    const error = await rejectsWith(client.restGet(TOKEN, '/user'), 'rate_limited');
    assert.ok((error.info.retryAfter ?? 0) > 3500);
  });
});
