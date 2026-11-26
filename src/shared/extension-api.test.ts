import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addMessageListener,
  extensionApi,
  extensionOrigin,
  sendingRuntime,
  storageArea,
} from './extension-api.ts';

function fakeApi(name: string) {
  const listeners: unknown[] = [];
  const sent: unknown[] = [];
  const api = {
    name,
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message);
        return 'answer';
      },
      onMessage: { addListener: (listener: unknown) => listeners.push(listener) },
      getURL: (path: string) => `ext://id/${path}`,
    },
    storage: { local: { area: 'local' }, sync: { area: 'sync' }, session: { area: 'session' } },
  };
  return { api: api as unknown as typeof chrome, listeners, sent };
}

describe('extensionApi', () => {
  it('prefers the promise-based browser namespace', () => {
    const browser = fakeApi('browser').api;
    const chrome = fakeApi('chrome').api;

    assert.equal(extensionApi({ browser, chrome }), browser);
    assert.equal(extensionApi({ chrome }), chrome);
  });

  it('throws outside of an extension context', () => {
    assert.throws(() => extensionApi({}), /not available/);
    assert.throws(() => extensionApi({ chrome: {} }), /not available/);
  });

  it('uses globalThis by default', () => {
    assert.throws(() => extensionApi(), /not available/);
  });
});

describe('adapters', () => {
  it('wraps sending, listening, origin and storage areas', async () => {
    const { api, listeners, sent } = fakeApi('chrome');
    const listener = () => false;

    assert.equal(await sendingRuntime(api).sendMessage({ a: 1 }), 'answer');
    addMessageListener(api, listener);

    assert.deepEqual(sent, [{ a: 1 }]);
    assert.deepEqual(listeners, [listener]);
    assert.equal(extensionOrigin(api), 'ext://id/');
    assert.deepEqual(storageArea(api, 'sync'), { area: 'sync' });
  });
});
