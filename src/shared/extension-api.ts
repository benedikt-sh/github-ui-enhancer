import type { MessageListener, SendingRuntime } from './messages.ts';
import { areaKey } from './storage.ts';
import type { StorageAreaLike } from './storage.ts';

type ExtensionApi = typeof chrome;

/**
 * Firefox exposes promise-based APIs as `browser`, Chrome only as `chrome`. Both support the
 * subset used here, so the first one present wins.
 */
export function extensionApi(scope: object = globalThis): ExtensionApi {
  const candidates = scope as { browser?: ExtensionApi; chrome?: ExtensionApi };
  const api = candidates.browser ?? candidates.chrome;
  if (api?.runtime === undefined) {
    throw new Error('Extension APIs are not available in this context.');
  }
  return api;
}

export function sendingRuntime(api: ExtensionApi): SendingRuntime {
  return { sendMessage: (message) => api.runtime.sendMessage(message) };
}

export function addMessageListener(api: ExtensionApi, listener: MessageListener): void {
  api.runtime.onMessage.addListener(listener);
}

export function extensionOrigin(api: ExtensionApi): string {
  return api.runtime.getURL('');
}

export function storageArea(api: ExtensionApi, area: 'local' | 'sync' | 'session'): StorageAreaLike {
  return api.storage[area];
}

/** Calls `listener` with the new value whenever `key` changes in `area`, also from other tabs. */
export function watchStorageKey(
  api: ExtensionApi,
  area: 'local' | 'sync',
  key: string,
  listener: (value: unknown) => void,
): () => void {
  const fullKey = areaKey(key);
  const onChanged = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    const change = changes[fullKey];
    if (areaName === area && change !== undefined) {
      listener(change.newValue);
    }
  };
  api.storage.onChanged.addListener(onChanged);
  return () => api.storage.onChanged.removeListener(onChanged);
}
