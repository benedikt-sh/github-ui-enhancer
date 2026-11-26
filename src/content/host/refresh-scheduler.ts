import type { Dispose, RefreshReason } from '../../shared/widget.ts';

export const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface Timers {
  /** Runs `callback` once after `ms`, the returned function cancels it. */
  schedule(callback: () => void, ms: number): Dispose;
}

export interface VisibilitySource {
  isVisible(): boolean;
  /** Called on every visibility change. */
  subscribe(listener: () => void): Dispose;
}

export type Clock = () => number;

export function documentVisibility(document: Document): VisibilitySource {
  return {
    isVisible: () => document.visibilityState === 'visible',
    subscribe(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

export function windowTimers(window: Pick<Window, 'setTimeout' | 'clearTimeout'>): Timers {
  return {
    schedule(callback, ms) {
      const handle = window.setTimeout(callback, ms);
      return () => window.clearTimeout(handle);
    },
  };
}

export interface RefreshSchedulerOptions {
  readonly intervalMs: number;
  readonly timers: Timers;
  readonly visibility: VisibilitySource;
  readonly clock: Clock;
  /** Automatic refreshes only happen while this returns true, e.g. not in the original view. */
  readonly isActive: () => boolean;
  readonly onRefresh: (reason: RefreshReason) => void;
}

export interface RefreshScheduler {
  refreshNow(): void;
  /** Fires `visible` if the last refresh is older than the interval, e.g. after reactivation. */
  resume(): void;
  dispose(): void;
}

/**
 * The timer restarts after every refresh, so a `visible` or `manual` refresh is never followed
 * by an `interval` refresh a few seconds later. While hidden the timer is not rearmed, the next
 * visibility change catches up instead.
 */
export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const { intervalMs, timers, visibility, clock, isActive, onRefresh } = options;
  let lastRefresh = clock();
  let cancelTimer: Dispose | null = null;
  let disposed = false;

  const canRefresh = (): boolean => !disposed && isActive() && visibility.isVisible();

  function clear(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  function arm(): void {
    clear();
    const delay = Math.max(0, lastRefresh + intervalMs - clock());
    cancelTimer = timers.schedule(tick, delay);
  }

  function tick(): void {
    cancelTimer = null;
    if (canRefresh()) {
      fire('interval');
    }
  }

  function fire(reason: RefreshReason): void {
    lastRefresh = clock();
    arm();
    onRefresh(reason);
  }

  // A pending timer covers the case where the last refresh is recent: it is only dropped by a
  // tick while inactive, which happens after the interval has passed.
  function resume(): void {
    if (canRefresh() && clock() - lastRefresh >= intervalMs) {
      fire('visible');
    }
  }

  const unsubscribe = visibility.subscribe(resume);
  arm();

  return {
    refreshNow() {
      if (!disposed) {
        fire('manual');
      }
    },
    resume,
    dispose() {
      disposed = true;
      clear();
      unsubscribe();
    },
  };
}
