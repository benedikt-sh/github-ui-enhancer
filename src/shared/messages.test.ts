import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeMessaging, EXTENSION_ORIGIN } from '../../test/fakes/runtime.ts';
import { dataResult } from '../../test/fakes/widget-data.ts';
import { ApiError } from './errors.ts';
import {
  createMessageListener,
  createRequestSender,
  isOperation,
  isRequestMessage,
  OPERATION_SCOPES,
} from './messages.ts';
import type { RequestHandlers } from './messages.ts';
import type { TokenInfo } from './tokens.ts';

const token: TokenInfo = {
  id: 't1',
  owner: 'octo-org',
  ownerSource: 'detected',
  status: 'valid',
  login: 'octocat',
  expiresAt: null,
  lastCheckedAt: null,
  hint: 'abcd',
};

function handlers(overrides: Partial<RequestHandlers> = {}): RequestHandlers {
  const unexpected = () => Promise.reject(new Error('unexpected call'));
  return {
    'data.repoIndex': unexpected,
    'data.searchPullRequests': unexpected,
    'data.searchIssues': unexpected,
    'data.subscribedIssues': unexpected,
    'data.workflowRuns': unexpected,
    'data.branches': unexpected,
    'tokens.summary': unexpected,
    'extension.openOptions': unexpected,
    'tokens.list': unexpected,
    'tokens.add': unexpected,
    'tokens.remove': unexpected,
    'tokens.validate': unexpected,
    'tokens.setOwner': unexpected,
    'cache.clear': unexpected,
    ...overrides,
  };
}

function setup(overrides: Partial<RequestHandlers> = {}) {
  const messaging = createFakeMessaging();
  messaging.addListener(
    createMessageListener(handlers(overrides), { extensionOrigin: EXTENSION_ORIGIN }),
  );
  return {
    messaging,
    fromContent: createRequestSender(messaging.content),
    fromExtension: createRequestSender(messaging.extensionPage),
  };
}

describe('request roundtrip', () => {
  it('delivers params and returns the handler result', async () => {
    let received: unknown;
    const { fromContent } = setup({
      'data.searchIssues': async (params) => {
        received = params;
        return dataResult([]);
      },
    });

    const result = await fromContent('data.searchIssues', { query: 'is:open', options: { limit: 5 } });

    assert.deepEqual(received, { query: 'is:open', options: { limit: 5 } });
    assert.deepEqual(result, dataResult([]));
  });

  it('turns handler errors into rejected ApiErrors', async () => {
    const { fromContent } = setup({
      'data.branches': () => Promise.reject(new ApiError({ kind: 'not_found', message: 'no repo' })),
    });

    await assert.rejects(
      fromContent('data.branches', { repo: { owner: 'a', name: 'b' } }),
      (error: unknown) => error instanceof ApiError && error.info.kind === 'not_found',
    );
  });

  it('maps unexpected handler errors to internal', async () => {
    const { fromContent } = setup({ 'tokens.summary': () => Promise.reject(new Error('kaputt')) });

    await assert.rejects(
      fromContent('tokens.summary', {}),
      (error: unknown) =>
        error instanceof ApiError && error.info.kind === 'internal' && error.message === 'kaputt',
    );
  });
});

describe('operation scopes', () => {
  it('allows extension operations from extension pages', async () => {
    const { fromExtension } = setup({ 'tokens.list': async () => [token] });

    assert.deepEqual(await fromExtension('tokens.list', {}), [token]);
  });

  it('refuses extension operations from content scripts', async () => {
    const { fromContent } = setup({ 'tokens.list': async () => [token] });

    await assert.rejects(
      fromContent('tokens.list', {}),
      (error: unknown) => error instanceof ApiError && error.info.kind === 'not_allowed',
    );
  });

  it('refuses extension operations from senders without url', async () => {
    const { messaging } = setup({ 'cache.clear': async () => null });

    const response = await messaging.sendFrom({}, { channel: 'ghx', op: 'cache.clear', params: {} });

    assert.deepEqual(response, {
      ok: false,
      error: { kind: 'not_allowed', message: '"cache.clear" is only available to extension pages.' },
    });
  });

  it('declares a scope for every operation', () => {
    assert.equal(Object.keys(OPERATION_SCOPES).length, Object.keys(handlers()).length);
  });
});

describe('message validation', () => {
  it('ignores messages of other channels', async () => {
    const { messaging } = setup();

    assert.equal(await messaging.content.sendMessage({ channel: 'other', op: 'x' }), undefined);
    assert.equal(await messaging.content.sendMessage('ping'), undefined);
  });

  it('answers malformed ghx messages with invalid_request', async () => {
    const { messaging } = setup();

    const response = await messaging.content.sendMessage({ channel: 'ghx', op: 'nope', params: {} });

    assert.deepEqual(response, {
      ok: false,
      error: { kind: 'invalid_request', message: 'Malformed request.' },
    });
  });

  it('recognizes operations and request messages', () => {
    assert.equal(isOperation('data.repoIndex'), true);
    assert.equal(isOperation('toString'), false);
    assert.equal(isOperation(42), false);
    assert.equal(isRequestMessage({ channel: 'ghx', op: 'cache.clear', params: {} }), true);
    assert.equal(isRequestMessage({ channel: 'ghx', op: 'cache.clear' }), false);
  });
});

describe('createRequestSender failures', () => {
  it('rejects when the background is unreachable', async () => {
    const send = createRequestSender(createFakeMessaging().content);

    await assert.rejects(
      send('tokens.summary', {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.info.kind === 'internal' &&
        error.message.includes('Receiving end does not exist'),
    );
  });

  it('rejects on missing or malformed responses', async () => {
    for (const response of [undefined, 'ok', { ok: 'yes' }]) {
      const send = createRequestSender({ sendMessage: async () => response });
      await assert.rejects(
        send('cache.clear', {}),
        (error: unknown) =>
          error instanceof ApiError && error.message === 'No valid response for "cache.clear".',
      );
    }
  });

  it('rejects with a generic error when the error payload is malformed', async () => {
    const send = createRequestSender({ sendMessage: async () => ({ ok: false, error: 'bad' }) });

    await assert.rejects(
      send('cache.clear', {}),
      (error: unknown) =>
        error instanceof ApiError && error.message === 'Request "cache.clear" failed.',
    );
  });
});
