import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createFetchFake,
  type FakeResponse,
  type FetchFake,
  type RecordedRequest,
} from '../../../test/fakes/fetch.ts';
import { createFakeStorageArea } from '../../../test/fakes/storage.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError, type ApiErrorInfo } from '../../shared/errors.ts';
import { isRecord, isString } from '../../shared/guards.ts';
import { createAreaStore } from '../../shared/storage.ts';
import { createCache } from '../cache/cache.ts';
import { createGitHubClient } from '../github/client.ts';
import { createTokenRegistry, type TokenRegistry } from '../tokens/token-registry.ts';
import {
  graphQLIssue,
  graphQLPullRequest,
  restBranch,
  restIssue,
  restPullRequestIssue,
  restRepo,
  restWorkflowRun,
} from './github-responses.fixture.ts';
import { createTokenProbe } from './token-probe.ts';
import {
  BRANCHES_MAX_PAGES,
  createDataLayer,
  type DataLayer,
  type DataLayerOptions,
  REPO_INDEX_MAX_PAGES,
  REPO_INDEX_TTL_MS,
  SEARCH_TTL_MS,
  SUBSCRIBED_TTL_MS,
  WORKFLOW_RUNS_TTL_MS,
} from './widget-data.ts';

const API = 'https://api.github.com';
const START = Date.parse('2026-11-27T10:00:00Z');
const ALICE = 'github_pat_alice0000';
const ACME = 'github_pat_acme1111';
const LOOSE = 'github_pat_loose2222';

interface SeedToken {
  readonly id: string;
  readonly secret: string;
  readonly owner: string | null;
}

const ALICE_TOKEN: SeedToken = { id: 't-alice', secret: ALICE, owner: 'alice' };
const ACME_TOKEN: SeedToken = { id: 't-acme', secret: ACME, owner: 'acme' };
const LOOSE_TOKEN: SeedToken = { id: 't-loose', secret: LOOSE, owner: null };

interface Setup {
  readonly data: DataLayer;
  readonly fake: FetchFake;
  readonly registry: TokenRegistry;
  readonly clock: { now: number };
}

function setup(
  tokens: readonly SeedToken[] = [ALICE_TOKEN, ACME_TOKEN],
  overrides: Partial<DataLayerOptions> = {},
): Setup {
  const clock = { now: START };
  const now = (): number => clock.now;
  const fake = createFetchFake();
  const store = createAreaStore(
    createFakeStorageArea({
      'ghx:tokens': {
        version: 1,
        entries: tokens.map((token) => ({
          ...token,
          ownerSource: token.owner === null ? null : 'detected',
          status: 'valid',
          login: 'alice',
          expiresAt: null,
          lastCheckedAt: null,
        })),
      },
    }),
  );
  const client = createGitHubClient({ fetch: fake.fetch, now });
  const registry = createTokenRegistry({
    store,
    probe: createTokenProbe(client),
    now: () => new Date(clock.now),
  });
  const data = createDataLayer({
    client,
    cache: createCache({ store, now }),
    registry,
    now,
    scheduleSearch: (flush) => void setImmediate(flush),
    ...overrides,
  });
  return { data, fake, registry, clock };
}

function withToken(secret: string, prefix: string) {
  return (request: RecordedRequest): boolean =>
    request.headers.get('authorization') === `Bearer ${secret}` &&
    (request.url === prefix || request.url.startsWith(`${prefix}?`));
}

function requestsTo(fake: FetchFake, prefix: string): RecordedRequest[] {
  return fake.requests.filter((r) => r.url === prefix || r.url.startsWith(`${prefix}?`));
}

function rateHeaders(resource: string, remaining: number, resetMillis: number) {
  return {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(Math.floor(resetMillis / 1000)),
    'x-ratelimit-resource': resource,
  };
}

function kinds(result: DataResult<unknown>): string[] {
  return result.errors.map((error) => error.kind);
}

function only(result: DataResult<unknown>): ApiErrorInfo {
  assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
  const [error] = result.errors;
  assert.ok(error !== undefined);
  return error;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function variables(request: RecordedRequest): Record<string, unknown> {
  const body: unknown = JSON.parse(request.body ?? '{}');
  const vars = isRecord(body) ? body['variables'] : undefined;
  return isRecord(vars) ? vars : {};
}

/** Answers batched searches; `answer` gets the token and the query of one alias. */
function answerSearches(
  fake: FetchFake,
  answer: (secret: string, query: string) => unknown,
  headers: Record<string, string> = {},
): void {
  fake.on(`${API}/graphql`, (request): FakeResponse => {
    const secret = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    const data: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(variables(request))) {
      if (name.startsWith('q') && isString(value)) {
        data[`s${name.slice(1)}`] = answer(secret, value);
      }
    }
    return { headers, body: { data } };
  });
}

const NO_TOKENS = { kind: 'no_tokens', message: 'No valid GitHub token is configured.' };

describe('createDataLayer without tokens', () => {
  it('answers every request with a no_tokens error', async () => {
    const { data, fake } = setup([]);
    const empty = { data: [], errors: [NO_TOKENS], fetchedAt: new Date(START).toISOString() };
    const repo = { owner: 'acme', name: 'web' };

    assert.deepEqual(await data.repoIndex(), { ...empty, stale: false });
    assert.deepEqual(await data.searchPullRequests('author:@me'), { ...empty, stale: false });
    assert.deepEqual(await data.searchIssues('author:@me'), { ...empty, stale: false });
    assert.deepEqual(await data.subscribedIssues(), { ...empty, stale: false });
    assert.deepEqual(await data.workflowRuns(repo), { ...empty, stale: false });
    assert.deepEqual(await data.branches(repo), { ...empty, stale: false });
    assert.equal(fake.requests.length, 0);
  });
});

describe('repoIndex', () => {
  it('merges the repositories of all tokens and dedupes them by node id', async () => {
    const { data, fake } = setup();
    const shared = restRepo({ node_id: 'R_shared', pushed_at: '2026-11-01T00:00:00Z' });
    fake.on(withToken(ALICE, `${API}/user/repos`), {
      headers: { link: `<${API}/user/repos?page=2>; rel="next"` },
      body: [restRepo({ node_id: 'R_a1', pushed_at: '2026-11-10T00:00:00Z' }), shared],
    });
    fake.on(withToken(ALICE, `${API}/user/repos?page=2`), {
      body: [restRepo({ node_id: 'R_a2', pushed_at: null }), { broken: true }],
    });
    fake.on(withToken(ACME, `${API}/user/repos`), {
      body: [
        restRepo({
          node_id: 'R_acme',
          name: 'web',
          full_name: 'acme/web',
          owner: { login: 'acme' },
          pushed_at: '2026-11-20T00:00:00Z',
        }),
        shared,
      ],
    });

    const result = await data.repoIndex();

    assert.deepEqual(
      result.data.map((repo) => repo.id),
      ['R_acme', 'R_a1', 'R_shared', 'R_a2'],
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.stale, false);
    assert.equal(result.fetchedAt, new Date(START).toISOString());
    assert.equal(
      requestsTo(fake, `${API}/user/repos`)[0]?.url,
      `${API}/user/repos?sort=pushed&per_page=100`,
    );
    assert.equal(fake.requests.length, 3);
  });

  it('serves the cache for an hour and then revalidates in the background', async () => {
    const { data, fake, clock } = setup([ALICE_TOKEN]);
    fake.once(`${API}/user/repos`, { body: [restRepo({ node_id: 'R_old' })] });
    fake.on(`${API}/user/repos`, { body: [restRepo({ node_id: 'R_new' })] });

    await data.repoIndex();
    clock.now += REPO_INDEX_TTL_MS - 1;
    assert.deepEqual((await data.repoIndex()).data.map((repo) => repo.id), ['R_old']);
    assert.equal(fake.requests.length, 1);

    clock.now += 1;
    const stale = await data.repoIndex();
    assert.deepEqual(stale.data.map((repo) => repo.id), ['R_old']);
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, new Date(START).toISOString());
    await settle();

    const fresh = await data.repoIndex();
    assert.deepEqual(fresh.data.map((repo) => repo.id), ['R_new']);
    assert.equal(fresh.stale, false);
    assert.equal(fake.requests.length, 2);
  });

  it('refetches when forced', async () => {
    const { data, fake } = setup([ALICE_TOKEN]);
    fake.on(`${API}/user/repos`, { body: [restRepo()] });

    await data.repoIndex();
    await data.repoIndex({ forceRefresh: true });

    assert.equal(fake.requests.length, 2);
  });

  it('reports a page cap as error entry, also from the cache', async () => {
    const { data, fake } = setup([ALICE_TOKEN]);
    fake.on(`${API}/user/repos`, {
      headers: { link: `<${API}/user/repos?page=next>; rel="next"` },
      body: [restRepo()],
    });

    const first = await data.repoIndex();
    const cached = await data.repoIndex();

    assert.equal(fake.requests.length, REPO_INDEX_MAX_PAGES);
    assert.equal(first.data.length, 1);
    const error = only(first);
    assert.equal(error.kind, 'internal');
    assert.equal(error.owner, 'alice');
    assert.match(error.message, /first 5000 repositories/);
    assert.deepEqual(cached.errors, first.errors);
  });

  it('keeps the data of working tokens when one fails and reports the failure', async () => {
    const { data, fake, registry } = setup();
    fake.on(withToken(ALICE, `${API}/user/repos`), { body: [restRepo()] });
    fake.on(withToken(ACME, `${API}/user/repos`), {
      status: 401,
      body: { message: 'Bad credentials' },
    });

    const result = await data.repoIndex();

    assert.equal(result.data.length, 1);
    const error = only(result);
    assert.equal(error.kind, 'unauthorized');
    assert.equal(error.owner, 'acme');
    const acme = (await registry.list()).find((token) => token.id === 't-acme');
    assert.equal(acme?.status, 'invalid');
    assert.deepEqual(
      (await registry.activeTokens()).map((token) => token.id),
      ['t-alice'],
    );
  });

  it('marks pending tokens and ignores tokens removed meanwhile', async () => {
    const { data, fake, registry } = setup([ALICE_TOKEN]);
    fake.on(`${API}/user/repos`, {
      status: 403,
      body: { message: 'This token is pending approval by the organization.' },
    });

    assert.deepEqual(kinds(await data.repoIndex()), ['pending_approval']);
    assert.equal((await registry.list())[0]?.status, 'pending_approval');

    const gone = setup([ALICE_TOKEN], {});
    const removing = createDataLayer({
      client: createGitHubClient({ fetch: gone.fake.fetch }),
      cache: createCache({ store: createAreaStore(createFakeStorageArea()), now: Date.now }),
      registry: {
        activeTokens: () => gone.registry.activeTokens(),
        tokenForOwner: (owner) => gone.registry.tokenForOwner(owner),
        reportFailure: () => Promise.reject(new ApiError({ kind: 'invalid_request', message: '' })),
      },
    });
    gone.fake.on(`${API}/user/repos`, { status: 401, body: { message: 'Bad credentials' } });
    assert.deepEqual(kinds(await removing.repoIndex()), ['unauthorized']);
  });

  it('never lets a secret into an error message', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ALICE, `${API}/user/repos`), { body: [] });
    fake.on(withToken(ACME, `${API}/user/repos`), {
      status: 500,
      body: { message: `boom ${ALICE} and ${ACME}` },
    });

    const error = only(await data.repoIndex());

    assert.equal(error.message.includes(ALICE), false);
    assert.equal(error.message.includes(ACME), false);
    assert.match(error.message, /\[redacted\] and \[redacted\]/);
  });

  it('rejects pages that are not lists', async () => {
    const { data, fake } = setup([ALICE_TOKEN]);
    fake.on(`${API}/user/repos`, { body: { message: 'odd' } });

    assert.deepEqual(kinds(await data.repoIndex()), ['invalid_response']);
  });

  it('keeps the owner an error already names', async () => {
    const { data, fake } = setup([ALICE_TOKEN]);
    fake.on(`${API}/user/repos`, { body: [restRepo()] });
    await data.repoIndex();
    fake.failNetwork(`${API}/user/repos`);

    const result = await data.repoIndex({ forceRefresh: true });

    assert.equal(result.stale, true);
    assert.equal(result.data.length, 1);
    assert.deepEqual(kinds(result), ['network']);
    assert.equal(only(result).owner, 'alice');
  });
});

describe('searchPullRequests and searchIssues', () => {
  it('batches concurrent searches into one GraphQL request per token', async () => {
    const { data, fake } = setup();
    const sharedPr = graphQLPullRequest({ id: 'PR_shared', updatedAt: '2026-11-20T00:00:00Z' });
    answerSearches(fake, (secret, query) => {
      if (query.startsWith('is:pr')) {
        return {
          nodes:
            secret === ALICE
              ? [graphQLPullRequest({ id: 'PR_a', updatedAt: '2026-11-25T00:00:00Z' }), sharedPr]
              : [sharedPr, graphQLPullRequest({ id: 'PR_b', updatedAt: '2026-11-26T00:00:00Z' })],
        };
      }
      return { nodes: [graphQLIssue({ id: `I_${secret}` }), null, {}] };
    });

    const [prs, issues] = await Promise.all([
      data.searchPullRequests(' author:@me ', { limit: 2 }),
      data.searchIssues('assignee:@me'),
    ]);

    assert.equal(fake.requests.length, 2);
    // The personal token skips orgs with their own token, the org token stays in its org.
    assert.deepEqual(variables(fake.requests[0]!), {
      q0: 'is:pr author:@me -org:acme',
      n0: 2,
      q1: 'is:issue assignee:@me -org:acme',
      n1: 20,
    });
    assert.deepEqual(variables(fake.requests[1]!), {
      q0: 'is:pr author:@me org:acme',
      n0: 2,
      q1: 'is:issue assignee:@me org:acme',
      n1: 20,
    });
    assert.deepEqual(
      prs.data.map((pr) => pr.id),
      ['PR_b', 'PR_a'],
    );
    assert.equal(prs.data[0]?.checkState, 'success');
    assert.deepEqual(issues.data.map((issue) => issue.id).sort(), [`I_${ACME}`, `I_${ALICE}`]);
    assert.deepEqual(prs.errors, []);
  });

  it('caches searches for a short time and refreshes when forced', async () => {
    const { data, fake, clock } = setup([ALICE_TOKEN]);
    answerSearches(fake, () => ({ nodes: [graphQLPullRequest()] }));

    await data.searchPullRequests('author:@me');
    await data.searchPullRequests('author:@me');
    assert.equal(fake.requests.length, 1);

    await data.searchPullRequests('author:@me', { limit: 5 });
    assert.equal(fake.requests.length, 2, 'another limit is another search');

    await data.searchPullRequests('author:@me', { forceRefresh: true });
    assert.equal(fake.requests.length, 3);

    clock.now += SEARCH_TTL_MS;
    await data.searchPullRequests('author:@me');
    assert.equal(fake.requests.length, 4);
  });

  it('reports hidden results and failed searches with the owner', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ALICE, `${API}/graphql`), {
      body: {
        data: { s0: { nodes: [null, graphQLIssue()] } },
        errors: [
          {
            type: 'FORBIDDEN',
            path: ['s0', 'nodes', 0],
            message: 'Resource protected by organization SAML enforcement.',
          },
        ],
      },
    });
    fake.failNetwork(withToken(ACME, `${API}/graphql`));

    const result = await data.searchIssues('is:open');

    assert.equal(result.data.length, 1);
    assert.deepEqual(
      result.errors.map((error) => [error.kind, error.owner]),
      [
        ['sso_required', 'alice'],
        ['network', 'acme'],
      ],
    );
  });

  it('does not call GitHub while the rate limit is exhausted', async () => {
    const { data, fake, clock } = setup([ALICE_TOKEN]);
    const reset = START + 120_000;
    answerSearches(fake, () => ({ nodes: [graphQLPullRequest()] }), rateHeaders('graphql', 0, reset));

    await data.searchPullRequests('author:@me');
    const limited = await data.searchPullRequests('author:@me', { forceRefresh: true });
    const uncached = await data.searchPullRequests('review-requested:@me');

    assert.equal(fake.requests.length, 1);
    assert.equal(limited.stale, true);
    assert.equal(limited.data.length, 1);
    assert.deepEqual(only(limited), {
      kind: 'rate_limited',
      message: `GitHub graphql rate limit is exhausted until ${new Date(reset).toISOString()}.`,
      retryAfter: 120,
      owner: 'alice',
    });
    assert.deepEqual(uncached.data, []);
    assert.deepEqual(kinds(uncached), ['rate_limited']);

    clock.now = reset;
    await data.searchPullRequests('author:@me', { forceRefresh: true });
    assert.equal(fake.requests.length, 2);
  });
});

describe('subscribedIssues', () => {
  const ISSUES = `${API}/issues`;

  it('drops pull requests, merges, sorts and limits', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ALICE, ISSUES), {
      body: [
        restIssue({ node_id: 'I_1', updated_at: '2026-11-20T00:00:00Z' }),
        restPullRequestIssue(9),
      ],
    });
    fake.on(withToken(ACME, ISSUES), {
      body: [
        restIssue({ node_id: 'I_2', updated_at: '2026-11-26T00:00:00Z' }),
        restIssue({ node_id: 'I_1', updated_at: '2026-11-20T00:00:00Z' }),
        restIssue({ node_id: 'I_3', updated_at: '2026-11-01T00:00:00Z' }),
      ],
    });

    const result = await data.subscribedIssues({ limit: 2 });

    assert.deepEqual(
      result.data.map((issue) => issue.id),
      ['I_2', 'I_1'],
    );
    assert.equal(
      requestsTo(fake, ISSUES)[0]?.url,
      `${ISSUES}?filter=subscribed&state=open&sort=updated&direction=desc&per_page=100`,
    );
  });

  it('revalidates with the ETag and keeps the data on 304', async () => {
    const { data, fake, clock } = setup([ALICE_TOKEN]);
    fake.once(ISSUES, { headers: { etag: 'W/"v1"' }, body: [restIssue()] });
    fake.on(ISSUES, { status: 304, headers: { etag: 'W/"v1"' } });

    await data.subscribedIssues();
    clock.now += SUBSCRIBED_TTL_MS;
    const result = await data.subscribedIssues();

    assert.equal(fake.requests[1]?.headers.get('if-none-match'), 'W/"v1"');
    assert.equal(result.data.length, 1);
    assert.equal(result.fetchedAt, new Date(clock.now).toISOString());
    assert.equal(result.stale, false);
  });

  it('serves the old list as stale when the refresh fails', async () => {
    const { data, fake, clock } = setup([ALICE_TOKEN]);
    fake.once(ISSUES, { body: [restIssue()] });
    fake.failNetwork(ISSUES);

    await data.subscribedIssues();
    clock.now += SUBSCRIBED_TTL_MS;
    const result = await data.subscribedIssues();

    assert.equal(fake.requests[1]?.headers.has('if-none-match'), false);
    assert.equal(result.stale, true);
    assert.equal(result.data.length, 1);
    assert.deepEqual(kinds(result), ['network']);
  });

  it('rejects answers that are not lists', async () => {
    const { data, fake } = setup([ALICE_TOKEN]);
    fake.on(ISSUES, { body: {} });

    assert.deepEqual(kinds(await data.subscribedIssues()), ['invalid_response']);
  });
});

describe('workflowRuns', () => {
  const RUNS = `${API}/repos/acme/web/actions/runs`;
  const repo = { owner: 'Acme', name: 'web' };

  it('routes to the token of the owner and passes the filters', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, `${API}/repos/Acme/web/actions/runs`), {
      body: {
        total_count: 3,
        workflow_runs: [
          restWorkflowRun({ id: 1 }),
          restWorkflowRun({ id: 2 }),
          restWorkflowRun({ id: 3 }),
          { id: 'broken' },
        ],
      },
    });

    const result = await data.workflowRuns(repo, { branch: ' main ', limit: 2 });

    assert.deepEqual(
      result.data.map((run) => run.id),
      [1, 2],
    );
    assert.deepEqual(result.errors, []);
    assert.equal(
      fake.requests[0]?.url,
      `${API}/repos/Acme/web/actions/runs?branch=main&per_page=2&exclude_pull_requests=true`,
    );
  });

  it('omits an empty branch filter and uses conditional requests', async () => {
    const { data, fake, clock } = setup();
    fake.once(withToken(ACME, `${API}/repos/Acme/web/actions/runs`), {
      headers: { etag: '"runs"' },
      body: { workflow_runs: [restWorkflowRun()] },
    });
    fake.on(withToken(ACME, `${API}/repos/Acme/web/actions/runs`), {
      status: 304,
      headers: { etag: '"runs"' },
    });

    await data.workflowRuns(repo, { branch: '  ' });
    clock.now += WORKFLOW_RUNS_TTL_MS;
    const result = await data.workflowRuns(repo, { branch: '' });

    assert.equal(fake.requests[0]?.url.includes('branch='), false);
    assert.equal(fake.requests[1]?.headers.get('if-none-match'), '"runs"');
    assert.equal(result.data.length, 1);
    assert.equal(result.fetchedAt, new Date(clock.now).toISOString());
  });

  it('uses the token that listed the repository when no owner token exists', async () => {
    const { data, fake } = setup([ALICE_TOKEN, LOOSE_TOKEN]);
    fake.on(withToken(ALICE, `${API}/user/repos`), { body: [] });
    fake.on(withToken(LOOSE, `${API}/user/repos`), {
      body: [restRepo({ name: 'web', full_name: 'acme/web', owner: { login: 'acme' } })],
    });
    fake.on(withToken(LOOSE, `${API}/repos/Acme/web/actions/runs`), {
      body: { workflow_runs: [] },
    });
    await data.repoIndex();

    const result = await data.workflowRuns(repo);

    assert.deepEqual(result.errors, []);
    assert.equal(requestsTo(fake, `${API}/repos/Acme/web/actions/runs`).length, 1);
  });

  it('tries every token for foreign repositories and remembers the one that worked', async () => {
    const { data, fake, clock } = setup();
    const runs = `${API}/repos/octo/public/actions/runs`;
    fake.on(withToken(ALICE, runs), { status: 404, body: { message: 'Not Found' } });
    fake.on(withToken(ACME, runs), { body: { workflow_runs: [restWorkflowRun()] } });

    const first = await data.workflowRuns({ owner: 'octo', name: 'public' });
    clock.now += WORKFLOW_RUNS_TTL_MS;
    const second = await data.workflowRuns({ owner: 'octo', name: 'public' });

    assert.equal(first.data.length, 1);
    assert.deepEqual(first.errors, []);
    assert.equal(second.data.length, 1);
    assert.deepEqual(
      requestsTo(fake, runs).map((request) => request.headers.get('authorization')),
      [`Bearer ${ALICE}`, `Bearer ${ACME}`, `Bearer ${ACME}`],
    );
  });

  it('reports no_token_for_owner when no token can read the repository', async () => {
    const { data, fake } = setup();
    fake.on(`${API}/repos/octo/secret/actions/runs`, { status: 404, body: {} });

    const result = await data.workflowRuns({ owner: 'octo', name: 'secret' });

    assert.deepEqual(result.data, []);
    assert.deepEqual(only(result), {
      kind: 'no_token_for_owner',
      message: 'No token can read octo/secret. Add a token for octo.',
      owner: 'octo',
    });
    assert.equal(fake.requests.length, 2);
  });

  it('stops trying other tokens on errors that are not about access', async () => {
    const { data, fake, registry } = setup();
    const runs = `${API}/repos/octo/public/actions/runs`;
    fake.on(withToken(ALICE, runs), { status: 401, body: { message: 'Bad credentials' } });
    fake.failNetwork(withToken(ACME, runs));

    const result = await data.workflowRuns({ owner: 'octo', name: 'public' });

    assert.deepEqual(kinds(result), ['network']);
    assert.equal(only(result).owner, 'octo');
    assert.equal((await registry.list())[0]?.status, 'invalid');
  });

  it('returns the error of the owner token without trying others', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, RUNS), {
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
    });

    const result = await data.workflowRuns({ owner: 'acme', name: 'web' });

    assert.deepEqual(kinds(result), ['forbidden']);
    assert.equal(only(result).owner, 'acme');
    assert.equal(fake.requests.length, 1);
  });

  it('rejects malformed answers and invalid repository names', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, RUNS), { body: { workflow_runs: 'nope' } });

    assert.deepEqual(kinds(await data.workflowRuns({ owner: 'acme', name: 'web' })), [
      'invalid_response',
    ]);
    await assert.rejects(
      data.workflowRuns({ owner: '..', name: '../user' }),
      (error: unknown) => error instanceof ApiError && error.info.kind === 'invalid_request',
    );
    await assert.rejects(data.branches({ owner: 'a b', name: 'c' }), ApiError);
  });

  it('serves cached runs as stale with rate_limited while the core limit is exhausted', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, RUNS), {
      headers: rateHeaders('core', 0, START + 60_000),
      body: { workflow_runs: [restWorkflowRun()] },
    });

    await data.workflowRuns({ owner: 'acme', name: 'web' });
    const result = await data.workflowRuns({ owner: 'acme', name: 'web' }, { forceRefresh: true });

    assert.equal(fake.requests.length, 1);
    assert.equal(result.stale, true);
    assert.equal(result.data.length, 1);
    assert.deepEqual(kinds(result), ['rate_limited']);
  });
});

describe('branches', () => {
  const BRANCHES = `${API}/repos/acme/web/branches`;

  it('lists branches over a few pages and reports the cap', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, BRANCHES), {
      headers: { link: `<${BRANCHES}?page=more>; rel="next"` },
      body: [restBranch('main', true), restBranch('dev')],
    });

    const result = await data.branches({ owner: 'acme', name: 'web' });

    assert.equal(fake.requests.length, BRANCHES_MAX_PAGES);
    assert.equal(fake.requests[0]?.url, `${BRANCHES}?per_page=100`);
    assert.deepEqual(result.data.slice(0, 2), [
      { name: 'main', protected: true },
      { name: 'dev', protected: false },
    ]);
    assert.equal(only(result).kind, 'internal');
    assert.match(only(result).message, /first 300 branches/);
    assert.equal(only(result).owner, 'acme');
  });

  it('serves branches from the cache', async () => {
    const { data, fake } = setup();
    fake.on(withToken(ACME, BRANCHES), { body: [restBranch('main')] });

    await data.branches({ owner: 'acme', name: 'web' });
    const result = await data.branches({ owner: 'ACME', name: 'Web' });

    assert.equal(fake.requests.length, 1);
    assert.deepEqual(result.errors, []);
  });
});

describe('clear', () => {
  it('drops cached data and routing knowledge', async () => {
    const { data, fake } = setup([ALICE_TOKEN, LOOSE_TOKEN]);
    fake.on(withToken(ALICE, `${API}/user/repos`), { body: [] });
    fake.on(withToken(LOOSE, `${API}/user/repos`), {
      body: [restRepo({ name: 'web', full_name: 'acme/web', owner: { login: 'acme' } })],
    });
    fake.on(`${API}/repos/acme/web/branches`, { body: [restBranch('main')] });
    await data.repoIndex();
    await data.branches({ owner: 'acme', name: 'web' });

    await data.clear();
    await data.repoIndex();
    await data.branches({ owner: 'acme', name: 'web' });

    assert.equal(requestsTo(fake, `${API}/user/repos`).length, 4);
    assert.deepEqual(
      requestsTo(fake, `${API}/repos/acme/web/branches`).map((r) =>
        r.headers.get('authorization'),
      ),
      [`Bearer ${LOOSE}`, `Bearer ${LOOSE}`],
    );
  });
});
