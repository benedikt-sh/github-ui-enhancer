export interface SettledWindow {
  addEventListener(type: 'load', listener: () => void, options: { once: true }): void;
  setTimeout(handler: () => void, timeout: number): unknown;
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => unknown;
}

/** Upper bound for waiting on an idle moment after `load`. */
export const SETTLE_TIMEOUT_MS = 1000;
/** Pause used when the browser has no `requestIdleCallback`. */
export const SETTLE_FALLBACK_MS = 300;

/**
 * Resolves once the page has loaded and the browser had an idle moment. GitHub prerenders parts
 * of the page (header, file lists) and React takes them over afterwards. A foreign node inserted
 * before that makes React discard and redraw the whole part, which shows as a flash.
 */
export function whenPageSettled(document: Document, window: SettledWindow): Promise<void> {
  return new Promise((resolve) => {
    const afterIdle = (): void => {
      if (window.requestIdleCallback === undefined) {
        window.setTimeout(resolve, SETTLE_FALLBACK_MS);
      } else {
        window.requestIdleCallback(resolve, { timeout: SETTLE_TIMEOUT_MS });
      }
    };
    if (document.readyState === 'complete') {
      afterIdle();
    } else {
      window.addEventListener('load', afterIdle, { once: true });
    }
  });
}
