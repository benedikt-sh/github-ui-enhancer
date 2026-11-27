import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFetchFake } from '../../../test/fakes/fetch.ts';
import { createFakeMessaging } from '../../../test/fakes/runtime.ts';
import { createFakeStorageArea } from '../../../test/fakes/storage.ts';
import type { DataResult } from '../../shared/data.ts';
import { createWidgetDataClient } from '../../shared/data-client.ts';
import { ApiError, type ApiErrorKind } from '../../shared/errors.ts';
import {
  createMessageListener,
  createRequestSender,
  type MessageSenderLike,
} from '../../shared/messages.ts';
import { createAreaStore } from '../../shared/storage.ts';
import { createCache } from '../cache/cache.ts';
import { createGitHubClient } from '../github/client.ts';
import { createTokenRegistry } from '../tokens/token-registry.ts';
import { restRepo } from './github-responses.fixture.ts';
import { createRequestHandlers, parseWorkflowRunOptions } from './request-handlers.ts';
import { createTokenProbe } from './token-probe.ts';
import { createDataLayer, type DataLayer } from './widget-data.ts';

const API = 'https://api.github.com';
const SECRET = 'github_pat_handler0000';
const SENDER: MessageSenderLike = { url: 'chrome-extension://fake-extension-id/options.html' };

function result<T>(data: T): DataResult<T> {
  return { data, errors: [], fetchedAt: '2026-11-27T10:00:00.000Z', stale: false };
}

interface RecordingData extends DataLayer {
  readonly calls: unknown[][];
  clears: number;
}

function recordingData(): RecordingData {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result([]);
    };
  const data: RecordingData = {
    calls,
    clears: 0,
    repoIndex: record('repoIndex'),
    searchPullRequests: record('searchPullRequests'),
    searchIssues: record('searchIssues'),
    subscribedIssues: record('subscribedIssues'),
    workflowRuns: record('workflowRuns'),
    branches: record('branches'),
    async clear() {
      data.clears += 1;
    },
  };
  return data;
}

function setup() {
  const fake = createFetchFake();
  const client = createGitHubClient({ fetch: fake.fetch });
  const registry = createTokenRegistry({
    store: createAreaStore(createFakeStorageArea()),
    probe: createTokenProbe(client),
    createId: () => 'id-1',
  });
  const data = recordingData();
  let opened = 0;
  const handlers = createRequestHandlers({
    data,
    registry,
    openOptionsPage: async () => {
      opened += 1;
    },
  });
  return { fake, registry, data, handlers, opened: () => opened };
}

function isKind(kind: ApiErrorKind) {
  return (error: unknown) => error instanceof ApiError && error.info.kind === kind;
}

function answerProbe(fake: ReturnType<typeof createFetchFake>): void {
  fake.on(`${API}/user`, { body: { login: 'alice' } });
  fake.on(`${API}/user/repos`, { body: [restRepo({ owner: { login: 'alice' } })] });
}

describe('createRequestHandlers', () => {
  it('passes validated data requests on', async () => {
    const { data, handlers } = setup();
    const repo = { owner: 'acme', name: 'web' };

    await handlers['data.repoIndex']({ options: { forceRefresh: true } }, SENDER);
    await handlers['data.repoIndex']({}, SENDER);
    await handlers['data.searchPullRequests']({ query: 'author:@me', options: { limit: 5 } }, SENDER);
    await handlers['data.searchIssues']({ query: 'x' }, SENDER);
    await handlers['data.subscribedIssues']({ options: { forceRefresh: false, limit: 3 } }, SENDER);
    await handlers['data.workflowRuns']({ repo, options: { branch: 'main', limit: 2 } }, SENDER);
    await handlers['data.branches']({ repo: { ...repo, extra: 1 } as typeof repo }, SENDER);

    assert.deepEqual(data.calls, [
      ['repoIndex', { forceRefresh: true }],
      ['repoIndex', {}],
      ['searchPullRequests', 'author:@me', { limit: 5 }],
      ['searchIssues', 'x', {}],
      ['subscribedIssues', { forceRefresh: false, limit: 3 }],
      ['workflowRuns', repo, { branch: 'main', limit: 2 }],
      ['branches', repo, {}],
    ]);
  });

  it('rejects malformed parameters', async () => {
    const { data, handlers } = setup();
    const bad: Promise<unknown>[] = [
      handlers['data.repoIndex']({ options: 'yes' as never }, SENDER),
      handlers['data.repoIndex']({ options: { forceRefresh: 1 } as never }, SENDER),
      handlers['data.searchIssues']({ query: 5 as never }, SENDER),
      handlers['data.searchIssues']({ query: 'x'.repeat(1001) }, SENDER),
      handlers['data.searchPullRequests']({ query: 'x', options: { limit: Infinity } }, SENDER),
      handlers['data.workflowRuns']({ repo: { owner: 'a' } as never }, SENDER),
      handlers['data.workflowRuns'](
        { repo: { owner: 'a', name: 'b' }, options: { branch: 1 } as never },
        SENDER,
      ),
      handlers['data.branches']({ repo: null as never }, SENDER),
      handlers['tokens.add']({ secret: 1 as never }, SENDER),
      handlers['tokens.add']({ secret: 'x', owner: 1 as never }, SENDER),
      handlers['tokens.remove']({ id: undefined as never }, SENDER),
      handlers['tokens.setOwner']({ id: 'a', owner: 1 as never }, SENDER),
    ];

    for (const request of bad) {
      await assert.rejects(request, isKind('invalid_request'));
    }
    assert.deepEqual(data.calls, []);
  });

  it('accepts explicitly undefined options', () => {
    assert.deepEqual(
      parseWorkflowRunOptions({ forceRefresh: undefined, limit: undefined, branch: undefined }),
      {},
    );
  });

  it('manages tokens and clears the data cache after every change', async () => {
    const { fake, data, handlers } = setup();
    answerProbe(fake);

    const added = await handlers['tokens.add']({ secret: SECRET }, SENDER);
    assert.equal(added.status, 'valid');
    assert.equal(added.owner, 'alice');
    assert.equal(JSON.stringify(added).includes(SECRET), false);
    assert.equal(data.clears, 1);

    assert.deepEqual(await handlers['tokens.list']({}, SENDER), [added]);
    assert.deepEqual(await handlers['tokens.summary']({}, SENDER), [added]);

    const manual = await handlers['tokens.setOwner']({ id: 'id-1', owner: 'acme' }, SENDER);
    assert.equal(manual.owner, 'acme');
    const detected = await handlers['tokens.setOwner']({ id: 'id-1', owner: null }, SENDER);
    assert.equal(detected.owner, 'alice');
    assert.equal((await handlers['tokens.validate']({ id: 'id-1' }, SENDER)).status, 'valid');
    assert.equal(data.clears, 4);

    assert.equal(await handlers['tokens.remove']({ id: 'id-1' }, SENDER), null);
    assert.deepEqual(await handlers['tokens.list']({}, SENDER), []);
    assert.equal(data.clears, 5);
  });

  it('clears the cache even if a token change fails', async () => {
    const { fake, data, handlers } = setup();
    fake.failNetwork(`${API}/user`);

    await assert.rejects(
      handlers['tokens.add']({ secret: SECRET, owner: 'alice' }, SENDER),
      isKind('network'),
    );
    await assert.rejects(handlers['tokens.remove']({ id: 'missing' }, SENDER), ApiError);

    assert.equal(data.clears, 2);
  });

  it('ignores storage failures while clearing after a token change', async () => {
    const { fake, registry } = setup();
    answerProbe(fake);
    const failing: DataLayer = {
      ...recordingData(),
      clear: () => Promise.reject(new Error('quota')),
    };
    const handlers = createRequestHandlers({
      data: failing,
      registry,
      openOptionsPage: async () => undefined,
    });

    assert.equal((await handlers['tokens.add']({ secret: SECRET }, SENDER)).status, 'valid');
    await assert.rejects(handlers['cache.clear']({}, SENDER), /quota/);
  });

  it('clears the cache and opens the options page on request', async () => {
    const { data, handlers, opened } = setup();

    assert.equal(await handlers['cache.clear']({}, SENDER), null);
    assert.equal(await handlers['extension.openOptions']({}, SENDER), null);

    assert.equal(data.clears, 1);
    assert.equal(opened(), 1);
  });
});

describe('request handlers behind the message listener', () => {
  it('serve widget data to the content script end to end', async () => {
    const fake = createFetchFake();
    answerProbe(fake);
    const client = createGitHubClient({ fetch: fake.fetch });
    const store = createAreaStore(createFakeStorageArea());
    const registry = createTokenRegistry({ store, probe: createTokenProbe(client) });
    const data = createDataLayer({ client, cache: createCache({ store, now: Date.now }), registry });
    const messaging = createFakeMessaging();
    messaging.addListener(
      createMessageListener(
        createRequestHandlers({ data, registry, openOptionsPage: async () => undefined }),
        { extensionOrigin: messaging.extensionOrigin },
      ),
    );
    const options = createRequestSender(messaging.extensionPage);
    const widgets = createWidgetDataClient(createRequestSender(messaging.content));

    await options('tokens.add', { secret: SECRET });
    const repos = await widgets.repoIndex();

    assert.deepEqual(
      repos.data.map((repo) => repo.fullName),
      ['octocat/Hello-World'],
    );
    await assert.rejects(
      createRequestSender(messaging.content)('tokens.list', {}),
      isKind('not_allowed'),
    );
    await assert.rejects(
      widgets.workflowRuns({ owner: '../..', name: 'x' }),
      isKind('invalid_request'),
    );
  });
});
