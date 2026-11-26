import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTopK } from './top-k.ts';

interface Item {
  readonly key: number;
  readonly label: string;
}

const byKey = (a: Item, b: Item): number => a.key - b.key;

function collect(limit: number, keys: readonly number[]): string[] {
  const top = createTopK(limit, byKey);
  keys.forEach((key, i) => top.offer({ key, label: `${key}:${i}` }));
  return top.items().map((item) => item.label);
}

describe('createTopK', () => {
  it('keeps the smallest items in order', () => {
    assert.deepEqual(collect(3, [5, 1, 9, 3, 7, 2]), ['1:1', '2:5', '3:3']);
  });

  it('keeps offer order for equal items', () => {
    assert.deepEqual(collect(3, [2, 1, 2, 1, 2]), ['1:1', '1:3', '2:0']);
  });

  it('returns everything when fewer items than the limit arrive', () => {
    assert.deepEqual(collect(10, [3, 1, 2]), ['1:1', '2:2', '3:0']);
  });

  it('keeps nothing for a zero limit', () => {
    assert.deepEqual(collect(0, [3, 1, 2]), []);
  });

  it('sorts once for large limits and still respects the limit', () => {
    const keys = Array.from({ length: 600 }, (_, i) => (i * 7919) % 600);
    const top = collect(300, keys);
    assert.equal(top.length, 300);
    assert.deepEqual(
      top.map((label) => Number(label.split(':')[0])),
      Array.from({ length: 300 }, (_, i) => i),
    );
    assert.equal(collect(Infinity, [2, 1]).length, 2);
  });

  it('returns a copy of the kept items', () => {
    const top = createTopK(2, byKey);
    top.offer({ key: 1, label: 'a' });
    top.items().pop();
    assert.equal(top.items().length, 1);
  });
});
