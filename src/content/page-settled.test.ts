import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SETTLE_FALLBACK_MS, SETTLE_TIMEOUT_MS, whenPageSettled } from './page-settled.ts';
import type { SettledWindow } from './page-settled.ts';

function fakeWindow(idle: boolean) {
  const calls: string[] = [];
  let onLoad: (() => void) | null = null;
  let pending: (() => void) | null = null;
  const window: SettledWindow = {
    addEventListener: (_type, listener) => {
      calls.push('load-listener');
      onLoad = listener;
    },
    setTimeout: (handler, timeout) => {
      calls.push(`timeout:${timeout}`);
      pending = handler;
    },
    ...(idle
      ? {
          requestIdleCallback: (callback: () => void, options: { timeout: number }) => {
            calls.push(`idle:${options.timeout}`);
            pending = callback;
          },
        }
      : {}),
  };
  return {
    window,
    calls,
    load: () => onLoad?.(),
    run: () => pending?.(),
  };
}

function documentIn(state: DocumentReadyState): Document {
  return { readyState: state } as Document;
}

describe('whenPageSettled', () => {
  it('waits for load and an idle moment', async () => {
    const fake = fakeWindow(true);
    let settled = false;
    const done = whenPageSettled(documentIn('interactive'), fake.window).then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.equal(settled, false);
    fake.load();
    assert.deepEqual(fake.calls, ['load-listener', `idle:${SETTLE_TIMEOUT_MS}`]);
    fake.run();
    await done;
    assert.equal(settled, true);
  });

  it('only waits for idle time on a loaded page', async () => {
    const fake = fakeWindow(true);
    const done = whenPageSettled(documentIn('complete'), fake.window);

    assert.deepEqual(fake.calls, [`idle:${SETTLE_TIMEOUT_MS}`]);
    fake.run();
    await done;
  });

  it('falls back to a short pause without requestIdleCallback', async () => {
    const fake = fakeWindow(false);
    const done = whenPageSettled(documentIn('complete'), fake.window);

    assert.deepEqual(fake.calls, [`timeout:${SETTLE_FALLBACK_MS}`]);
    fake.run();
    await done;
  });
});
