import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openUrlIn } from './open-url.ts';
import type { BrowserWindow } from './open-url.ts';

function fakeWindow(): BrowserWindow & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    open: (url, target, features) => calls.push(`open ${url} ${target} ${features}`),
    location: { assign: (url) => calls.push(`assign ${url}`) },
  };
}

describe('openUrlIn', () => {
  it('navigates the current tab', () => {
    const win = fakeWindow();

    openUrlIn(win, 'https://github.com/acme/app', false);

    assert.deepEqual(win.calls, ['assign https://github.com/acme/app']);
  });

  it('opens a new tab without opener', () => {
    const win = fakeWindow();

    openUrlIn(win, 'https://github.com/acme/app', true);

    assert.deepEqual(win.calls, ['open https://github.com/acme/app _blank noopener,noreferrer']);
  });
});
