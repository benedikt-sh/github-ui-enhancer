import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { RefreshReason } from '../../shared/widget.ts';
import { createFakeTime, createFakeVisibility } from './host.fixture.ts';
import {
  createRefreshScheduler,
  documentVisibility,
  windowTimers,
} from './refresh-scheduler.ts';

const MINUTE = 60_000;

function setup(options: { active?: () => boolean; visible?: boolean } = {}) {
  const time = createFakeTime(1000);
  const visibility = createFakeVisibility(options.visible ?? true);
  const reasons: RefreshReason[] = [];
  const scheduler = createRefreshScheduler({
    intervalMs: 5 * MINUTE,
    timers: time,
    visibility,
    clock: time.clock,
    isActive: options.active ?? (() => true),
    onRefresh: (reason) => reasons.push(reason),
  });
  return { time, visibility, reasons, scheduler };
}

describe('createRefreshScheduler', () => {
  it('fires interval refreshes while visible', () => {
    const { time, reasons } = setup();
    time.advance(5 * MINUTE - 1);
    assert.deepEqual(reasons, []);
    time.advance(1);
    assert.deepEqual(reasons, ['interval']);
    time.advance(10 * MINUTE);
    assert.deepEqual(reasons, ['interval', 'interval', 'interval']);
  });

  it('skips the interval while hidden and catches up when visible again', () => {
    const { time, visibility, reasons } = setup();
    visibility.set(false);
    time.advance(20 * MINUTE);
    assert.deepEqual(reasons, []);
    assert.equal(time.pending(), 0);
    visibility.set(true);
    assert.deepEqual(reasons, ['visible']);
    time.advance(5 * MINUTE);
    assert.deepEqual(reasons, ['visible', 'interval']);
  });

  it('does not refresh on visibility when the last refresh is recent', () => {
    const { time, visibility, reasons } = setup();
    visibility.set(false);
    time.advance(MINUTE);
    visibility.set(true);
    assert.deepEqual(reasons, []);
    time.advance(4 * MINUTE);
    assert.deepEqual(reasons, ['interval']);
  });

  it('restarts the interval after a manual refresh', () => {
    const { time, reasons, scheduler } = setup();
    time.advance(4 * MINUTE);
    scheduler.refreshNow();
    time.advance(4 * MINUTE);
    assert.deepEqual(reasons, ['manual']);
    time.advance(MINUTE);
    assert.deepEqual(reasons, ['manual', 'interval']);
  });

  it('only refreshes automatically while active', () => {
    let active = false;
    const { time, reasons, scheduler } = setup({ active: () => active });
    time.advance(10 * MINUTE);
    scheduler.resume();
    assert.deepEqual(reasons, []);
    active = true;
    scheduler.resume();
    assert.deepEqual(reasons, ['visible']);
  });

  it('stops everything on dispose', () => {
    const { time, visibility, reasons, scheduler } = setup();
    scheduler.dispose();
    assert.equal(time.pending(), 0);
    assert.equal(visibility.listenerCount(), 0);
    scheduler.refreshNow();
    scheduler.resume();
    time.advance(10 * MINUTE);
    assert.deepEqual(reasons, []);
  });
});

describe('browser adapters', () => {
  let dom: DomEnvironment;

  before(() => {
    dom = installDom();
  });

  after(async () => {
    await dom.cleanup();
  });

  it('reads and observes the document visibility', () => {
    const visibility = documentVisibility(document);
    let calls = 0;
    const unsubscribe = visibility.subscribe(() => {
      calls += 1;
    });
    assert.equal(visibility.isVisible(), document.visibilityState === 'visible');
    document.dispatchEvent(new Event('visibilitychange'));
    unsubscribe();
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 1);
  });

  it('wraps window timers', async () => {
    const timers = windowTimers(dom.window as unknown as Window);
    let fired = false;
    const cancel = timers.schedule(() => assert.fail('cancelled timer fired'), 0);
    cancel();
    await new Promise<void>((resolve) => {
      timers.schedule(() => {
        fired = true;
        resolve();
      }, 0);
    });
    assert.equal(fired, true);
  });
});
