/** Subset of `chrome.storage.StorageArea` the extension relies on. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/**
 * Values come back as `unknown` on purpose: stored data may stem from an older version of
 * the extension, so every reader validates what it gets.
 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export const STORAGE_KEYS = {
  tokens: 'tokens',
  layout: 'layout',
  cachePrefix: 'cache:',
} as const;

const PREFIX = 'ghx:';

export function createAreaStore(area: StorageAreaLike): KeyValueStore {
  return {
    async get(key) {
      const fullKey = PREFIX + key;
      const items = await area.get(fullKey);
      return items[fullKey];
    },
    set: (key, value) => area.set({ [PREFIX + key]: value }),
    remove: (key) => area.remove(PREFIX + key),
  };
}
