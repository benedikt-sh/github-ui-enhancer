import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSerialQueue } from './serial-queue.ts';

describe('createSerialQueue', () => {
  it('runs tasks strictly one after another', async () => {
    const run = createSerialQueue();
    const events: string[] = [];
    const task = (name: string, delay: number) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([run(task('a', 5)), run(task('b', 0))]);

    assert.deepEqual(results, ['a', 'b']);
    assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b']);
  });

  it('keeps running after a failed task', async () => {
    const run = createSerialQueue();

    const failed = run(() => Promise.reject(new Error('boom')));
    const next = run(async () => 'ok');

    await assert.rejects(failed, /boom/);
    assert.equal(await next, 'ok');
  });
});
