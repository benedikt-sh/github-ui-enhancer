import type { StorageAreaLike } from '../../src/shared/storage.ts';

export interface FakeStorageArea extends StorageAreaLike {
  snapshot(): Record<string, unknown>;
  /** Makes the next calls fail, e.g. to simulate an exceeded quota. */
  failWith(error: Error | null): void;
}

/** Values are cloned on the way in and out, like the real storage serializes them. */
export function createFakeStorageArea(initial: Record<string, unknown> = {}): FakeStorageArea {
  const items = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  let failure: Error | null = null;

  const check = (): void => {
    if (failure !== null) {
      throw failure;
    }
  };
  const toKeys = (keys: string | string[]): string[] => (Array.isArray(keys) ? keys : [keys]);

  return {
    async get(keys) {
      check();
      const result: Record<string, unknown> = {};
      for (const key of toKeys(keys)) {
        if (items.has(key)) {
          result[key] = structuredClone(items.get(key));
        }
      }
      return result;
    },
    async set(values) {
      check();
      for (const [key, value] of Object.entries(values)) {
        items.set(key, structuredClone(value));
      }
    },
    async remove(keys) {
      check();
      for (const key of toKeys(keys)) {
        items.delete(key);
      }
    },
    snapshot: () => structuredClone(Object.fromEntries(items)),
    failWith(error) {
      failure = error;
    },
  };
}
