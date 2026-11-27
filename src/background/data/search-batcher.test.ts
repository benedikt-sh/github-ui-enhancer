import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFetchFake, type RecordedRequest } from '../../../test/fakes/fetch.ts';
import { ApiError, type ApiErrorKind } from '../../shared/errors.ts';
import { isRecord } from '../../shared/guards.ts';
import { createGitHubClient } from '../github/client.ts';
import { graphQLIssue, graphQLPullRequest } from './github-responses.fixture.ts';
import type { SearchRequest } from './queries.ts';
import {
  createSearchBatcher,
  MAX_SEARCHES_PER_DOCUMENT,
  SEARCH_BATCH_WINDOW_MS,
} from './search-batcher.ts';

const GRAPHQL = 'https://api.github.com/graphql';
const ALICE = { id: 'a', secret: 'github_pat_alice' };
const ACME = { id: 'b', secret: 'github_pat_acme' };

const PRS: SearchRequest = { kind: 'pullRequest', query: 'is:pr author:@me', first: 20 };
const ISSUES: SearchRequest = { kind: 'issue', query: 'is:issue assignee:@me', first: 10 };

function setup() {
  const fake = createFetchFake();
  const flushes: (() => void)[] = [];
  const batcher = createSearchBatcher({
    client: createGitHubClient({ fetch: fake.fetch }),
    schedule: (flush) => flushes.push(flush),
  });
  const flush = (): void => {
    for (const run of flushes.splice(0)) {
      run();
    }
  };
  return { fake, batcher, flush, flushes };
}

function body(request: RecordedRequest | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(request?.body ?? 'null');
  assert.ok(isRecord(parsed));
  return parsed;
}

function isKind(kind: ApiErrorKind) {
  return (error: unknown) => error instanceof ApiError && error.info.kind === kind;
}

describe('createSearchBatcher', () => {
  it('sends searches of one window as one request per token', async () => {
    const { fake, batcher, flush, flushes } = setup();
    fake.on(GRAPHQL, (request) => {
      const token = request.headers.get('authorization');
      return {
        body: {
          data: {
            s0: { nodes: [graphQLPullRequest({ id: `pr-${token}` })] },
            s1: { nodes: [graphQLIssue()] },
          },
        },
      };
    });

    const results = Promise.all([
      batcher.search(ALICE, PRS),
      batcher.search(ALICE, ISSUES),
      batcher.search(ACME, PRS),
    ]);
    assert.equal(flushes.length, 1);
    flush();
    const [alicePrs, aliceIssues, acmePrs] = await results;

    assert.equal(fake.requests.length, 2);
    const [first, second] = fake.requests;
    assert.equal(first?.headers.get('authorization'), `Bearer ${ALICE.secret}`);
    assert.deepEqual(body(first)['variables'], {
      q0: PRS.query,
      n0: 20,
      q1: ISSUES.query,
      n1: 10,
    });
    assert.equal(second?.headers.get('authorization'), `Bearer ${ACME.secret}`);
    assert.deepEqual(body(second)['variables'], { q0: PRS.query, n0: 20 });
    assert.deepEqual(alicePrs, {
      nodes: [graphQLPullRequest({ id: `pr-Bearer ${ALICE.secret}` })],
      errors: [],
    });
    assert.deepEqual(aliceIssues.nodes, [graphQLIssue()]);
    assert.deepEqual(acmePrs.nodes, [graphQLPullRequest({ id: `pr-Bearer ${ACME.secret}` })]);
  });

  it('starts a new window after a flush', async () => {
    const { fake, batcher, flush, flushes } = setup();
    fake.on(GRAPHQL, { body: { data: { s0: { nodes: [] } } } });

    const first = batcher.search(ALICE, PRS);
    flush();
    await first;
    const second = batcher.search(ALICE, PRS);
    assert.equal(flushes.length, 1);
    flush();
    await second;

    assert.equal(fake.requests.length, 2);
  });

  it('splits large batches into several documents', async () => {
    const { fake, batcher, flush } = setup();
    fake.on(GRAPHQL, (request) => {
      const variables = body(request)['variables'];
      const count = isRecord(variables) ? Object.keys(variables).length / 2 : 0;
      const data = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`s${index}`, { nodes: [] }]),
      );
      return { body: { data } };
    });

    const searches = Array.from({ length: MAX_SEARCHES_PER_DOCUMENT + 1 }, (_, index) =>
      batcher.search(ALICE, { ...PRS, query: `is:pr q${index}` }),
    );
    flush();
    await Promise.all(searches);

    assert.equal(fake.requests.length, 2);
    assert.deepEqual(body(fake.requests[1])['variables'], { q0: 'is:pr q10', n0: 20 });
  });

  it('rejects only the searches whose field failed and keeps nested errors', async () => {
    const { fake, batcher, flush } = setup();
    fake.on(GRAPHQL, {
      body: {
        data: { s0: null, s1: { nodes: [null, graphQLIssue()] } },
        errors: [
          { type: 'INVALID_QUERY', path: ['s0'], message: 'Bad search' },
          {
            type: 'FORBIDDEN',
            path: ['s1', 'nodes', 0],
            message: 'Resource protected by organization SAML enforcement.',
          },
        ],
      },
    });

    const failing = batcher.search(ALICE, PRS);
    const partial = batcher.search(ALICE, ISSUES);
    flush();

    await assert.rejects(failing, isKind('internal'));
    const outcome = await partial;
    assert.deepEqual(outcome.nodes, [null, graphQLIssue()]);
    assert.deepEqual(
      outcome.errors.map((error) => error.kind),
      ['sso_required'],
    );
  });

  it('falls back to unrelated errors or invalid_response for missing fields', async () => {
    const { fake, batcher, flush } = setup();
    fake.once(GRAPHQL, {
      body: {
        data: { s0: { nodes: 'odd' }, s1: null },
        errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      },
    });
    fake.once(GRAPHQL, { body: { data: { s0: { nodes: [] } } } });

    const odd = batcher.search(ALICE, PRS);
    const limited = batcher.search(ALICE, ISSUES);
    flush();
    assert.deepEqual(await odd, { nodes: [], errors: [] });
    await assert.rejects(limited, isKind('rate_limited'));

    const missing = batcher.search(ALICE, PRS);
    const alsoMissing = batcher.search(ALICE, ISSUES);
    fake.once(GRAPHQL, { body: { data: { s0: { nodes: [] } } } });
    flush();
    await missing;
    await assert.rejects(alsoMissing, isKind('invalid_response'));
  });

  it('rejects every search of a failed request', async () => {
    const { fake, batcher, flush } = setup();
    fake.on(GRAPHQL, { status: 401, body: { message: 'Bad credentials' } });

    const searches = [batcher.search(ALICE, PRS), batcher.search(ALICE, ISSUES)];
    flush();

    for (const search of searches) {
      await assert.rejects(search, isKind('unauthorized'));
    }
  });

  it('waits for the batch window by default', async () => {
    const fake = createFetchFake();
    fake.on(GRAPHQL, { body: { data: { s0: { nodes: [] }, s1: { nodes: [] } } } });
    const batcher = createSearchBatcher({ client: createGitHubClient({ fetch: fake.fetch }) });

    const first = batcher.search(ALICE, PRS);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_BATCH_WINDOW_MS / 3));
    const second = batcher.search(ALICE, ISSUES);
    await Promise.all([first, second]);

    assert.equal(fake.requests.length, 1);
  });
});
