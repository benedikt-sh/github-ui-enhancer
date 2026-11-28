import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapConcurrently } from './concurrency.ts';

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('mapConcurrently', () => {
  it('keeps the order of the items and runs at most limit tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrently([5, 1, 4, 2, 3], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      for (let wait = 0; wait < value; wait += 1) {
        await tick();
      }
      running -= 1;
      return value * 10;
    });

    assert.deepEqual(results, [50, 10, 40, 20, 30]);
    assert.equal(peak, 2);
  });

  it('runs one task at a time for limits below one and handles no items', async () => {
    let running = 0;
    let peak = 0;
    const task = async (value: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return value;
    };

    assert.deepEqual(await mapConcurrently([1, 2, 3], 0, task), [1, 2, 3]);
    assert.equal(peak, 1);
    assert.deepEqual(await mapConcurrently([], 4, task), []);
  });

  it('rejects with the error of a failing task', async () => {
    await assert.rejects(
      mapConcurrently([1, 2], 2, async (value) => {
        if (value === 2) {
          throw new Error('boom');
        }
        return value;
      }),
      /boom/,
    );
  });
});
