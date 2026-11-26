import { findMountPoint, isLoggedIn, isStartPath } from './selectors.ts';
import type { MountPoint } from './selectors.ts';

export const ROOT_ID = 'ghx-root';
/** Set on `<html>` while the start page is undecided, hides GitHub's content via `mount.css`. */
export const PENDING_CLASS = 'ghx-pending';
/** Set on the container holding the root, value is the `MountPlacement`. */
export const MOUNT_ATTRIBUTE = 'data-ghx-mount';
/** Set on the container next to `MOUNT_ATTRIBUTE`, value is the current `MountView`. */
export const VIEW_ATTRIBUTE = 'data-ghx-view';

export const DEFAULT_TIMEOUT_MS = 3000;

export type MountView = 'dashboard' | 'original';

export type MountWindow = Pick<
  Window,
  'location' | 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'
> &
  Pick<typeof globalThis, 'MutationObserver'>;

export interface MountControllerOptions {
  readonly document: Document;
  readonly window: MountWindow;
  /** Called once per root element when the start page becomes active. */
  readonly onEnter: (root: HTMLElement) => void;
  /** Called before the root is removed: navigation away, mount point lost or `stop`. */
  readonly onLeave: () => void;
  /** Upper bound for hiding GitHub's content before the page could be checked. */
  readonly timeoutMs?: number;
}

export interface MountController {
  readonly root: HTMLElement | null;
  /** Resets to `dashboard` whenever the root is removed. */
  readonly view: MountView;
  start(): void;
  /** Removes listeners and every trace in the DOM, calling `onLeave` if a root is active. */
  stop(): void;
  /** Shows GitHub's original page for the current page view, the root stays in place. */
  showOriginal(): void;
  showDashboard(): void;
}

/**
 * Content scripts run in an isolated world and do not see the page's `history.pushState`
 * calls. Turbo and React soft navigations are therefore detected through DOM signals: Turbo
 * events, `popstate` and a MutationObserver that notices the changed URL with the next render.
 */
export function createMountController(options: MountControllerOptions): MountController {
  const { document, window, onEnter, onLeave } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const html = document.documentElement;
  let root: HTMLElement | null = null;
  let view: MountView = 'dashboard';
  let timer: number | null = null;
  let observer: MutationObserver | null = null;

  const documentEvents = ['DOMContentLoaded', 'turbo:load', 'turbo:render'] as const;

  function sync(): void {
    if (!isStartPath(window.location.pathname)) {
      leaveIfActive();
    } else if (document.readyState !== 'loading') {
      if (!isLoggedIn(document)) {
        leaveIfActive();
      } else if (!isPlaced()) {
        place();
      }
    } else if (document.body !== null && !isLoggedIn(document)) {
      // While loading, the head is complete once the body exists, so a missing login is final.
      leaveIfActive();
    }
  }

  /** Cheap check first, `sync` runs for every mutation batch on every GitHub page. */
  function leaveIfActive(): void {
    if (root !== null || timer !== null || document.getElementById(ROOT_ID) !== null) {
      leave();
    }
  }

  function isPlaced(): boolean {
    return (
      root?.isConnected === true && root.parentElement?.hasAttribute(MOUNT_ATTRIBUTE) === true
    );
  }

  function place(): void {
    // Turbo restores cached snapshots that contain a lifeless copy of the root.
    removeTraces(root);
    const point = findMountPoint(document, root);
    if (point === null) {
      leave();
      return;
    }
    const element = root ?? createRoot();
    insert(element, point);
    point.container.setAttribute(MOUNT_ATTRIBUTE, point.placement);
    point.container.setAttribute(VIEW_ATTRIBUTE, view);
    clearPending();
    if (root === null) {
      root = element;
      onEnter(element);
    }
  }

  function createRoot(): HTMLElement {
    const element = document.createElement('div');
    element.id = ROOT_ID;
    return element;
  }

  function insert(element: HTMLElement, point: MountPoint): void {
    if (point.placement === 'first-child') {
      point.container.prepend(element);
    } else {
      point.header.after(element);
    }
  }

  function leave(): void {
    const previous = root;
    root = null;
    view = 'dashboard';
    try {
      if (previous !== null) {
        onLeave();
      }
    } finally {
      clearPending();
      removeTraces(null);
    }
  }

  function removeTraces(keep: HTMLElement | null): void {
    for (const element of document.querySelectorAll(`#${ROOT_ID}`)) {
      if (element !== keep) {
        element.remove();
      }
    }
    for (const element of document.querySelectorAll(`[${MOUNT_ATTRIBUTE}]`)) {
      element.removeAttribute(MOUNT_ATTRIBUTE);
      element.removeAttribute(VIEW_ATTRIBUTE);
    }
  }

  function clearPending(): void {
    html.classList.remove(PENDING_CLASS);
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function setView(next: MountView): void {
    if (root === null) {
      return;
    }
    view = next;
    const container = root.parentElement;
    if (container?.hasAttribute(MOUNT_ATTRIBUTE)) {
      container.setAttribute(VIEW_ATTRIBUTE, next);
    }
  }

  return {
    get root() {
      return root;
    },
    get view() {
      return view;
    },
    start() {
      if (observer !== null) {
        return;
      }
      if (isStartPath(window.location.pathname)) {
        html.classList.add(PENDING_CLASS);
        timer = window.setTimeout(clearPending, timeoutMs);
      }
      for (const type of documentEvents) {
        document.addEventListener(type, sync);
      }
      window.addEventListener('popstate', sync);
      observer = new window.MutationObserver(sync);
      observer.observe(document, { childList: true, subtree: true });
      sync();
    },
    stop() {
      if (observer === null) {
        return;
      }
      observer.disconnect();
      observer = null;
      for (const type of documentEvents) {
        document.removeEventListener(type, sync);
      }
      window.removeEventListener('popstate', sync);
      leave();
    },
    showOriginal: () => setView('original'),
    showDashboard: () => setView('dashboard'),
  };
}
