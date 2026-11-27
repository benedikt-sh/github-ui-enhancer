import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addMessageListener,
  extensionApi,
  extensionOrigin,
  sendingRuntime,
  storageArea,
  watchStorageKey,
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

describe('watchStorageKey', () => {
  it('reports new values of one key in one area until unsubscribed', () => {
    type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    const listeners = new Set<Listener>();
    const api = {
      storage: {
        onChanged: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
    } as unknown as typeof chrome;
    const seen: unknown[] = [];
    const emit = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      for (const listener of listeners) {
        listener(changes, area);
      }
    };

    const stop = watchStorageKey(api, 'sync', 'tweaks', (value) => seen.push(value));
    emit({ 'ghx:tweaks': { newValue: { a: 1 } } }, 'sync');
    emit({ 'ghx:tweaks': { newValue: 'local' } }, 'local');
    emit({ 'ghx:layout': { newValue: 'other' } }, 'sync');
    emit({ 'ghx:tweaks': {} }, 'sync');
    stop();
    emit({ 'ghx:tweaks': { newValue: 'late' } }, 'sync');

    assert.deepEqual(seen, [{ a: 1 }, undefined]);
    assert.equal(listeners.size, 0);
  });
});
