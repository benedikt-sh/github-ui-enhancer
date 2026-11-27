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
  singletons: 'singletons',
  tweaks: 'tweaks',
  headerPins: 'headerPins',
  cachePrefix: 'cache:',
} as const;

const PREFIX = 'ghx:';

/** Key as it appears in the storage area, e.g. in `storage.onChanged` events. */
export function areaKey(key: string): string {
  return PREFIX + key;
}

export function createAreaStore(area: StorageAreaLike): KeyValueStore {
  return {
    async get(key) {
      const fullKey = areaKey(key);
      const items = await area.get(fullKey);
      return items[fullKey];
    },
    set: (key, value) => area.set({ [areaKey(key)]: value }),
    remove: (key) => area.remove(areaKey(key)),
  };
}
