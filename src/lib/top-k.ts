export interface TopK<T> {
  offer(item: T): void;
  /** The kept items in ascending `compare` order. */
  items(): T[];
}

// Above this, inserting into a sorted array costs more than sorting everything once.
const MAX_INSERTION_LIMIT = 256;

/**
 * Keeps the first `limit` items by `compare` without sorting everything offered.
 * Items that compare equal keep their offer order.
 */
export function createTopK<T>(limit: number, compare: (a: T, b: T) => number): TopK<T> {
  const kept: T[] = [];

  if (limit > MAX_INSERTION_LIMIT) {
    return {
      offer: (item) => {
        kept.push(item);
      },
      items: () => kept.sort(compare).slice(0, limit),
    };
  }

  return {
    offer(item) {
      const last = kept.at(-1);
      if (kept.length >= limit && (last === undefined || compare(item, last) >= 0)) {
        return;
      }
      let low = 0;
      let high = kept.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        // In bounds because middle < kept.length.
        if (compare(item, kept[middle] as T) < 0) {
          high = middle;
        } else {
          low = middle + 1;
        }
      }
      kept.splice(low, 0, item);
      if (kept.length > limit) {
        kept.pop();
      }
    },
    items: () => [...kept],
  };
}
