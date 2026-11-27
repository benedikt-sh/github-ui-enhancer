import { ROOT_ID } from '../mount/mount-controller.ts';
import type { MountWindow } from '../mount/mount-controller.ts';
import { findChangelogWidgets, isStartPath } from '../mount/selectors.ts';

/** Marks elements hidden by a tweak, `tweaks.css` hides them. */
export const HIDDEN_ATTRIBUTE = 'data-ghx-hidden';
const CHANGELOG = 'changelog';

export interface ChangelogHider {
  start(): void;
  /** Removes the observer and shows every hidden element again. */
  stop(): void;
}

export interface ChangelogHiderOptions {
  readonly document: Document;
  readonly window: Pick<MountWindow, 'location' | 'MutationObserver'>;
}

/**
 * GitHub renders the start page client-side and may re-render the widget at any time, so the
 * page is checked again after every DOM change while the hider runs.
 */
export function createChangelogHider(options: ChangelogHiderOptions): ChangelogHider {
  const { document, window } = options;
  let observer: MutationObserver | null = null;

  function showAll(): void {
    for (const element of document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}="${CHANGELOG}"]`)) {
      element.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  function apply(): void {
    if (!isStartPath(window.location.pathname)) {
      showAll();
      return;
    }
    for (const element of findChangelogWidgets(document, document.getElementById(ROOT_ID))) {
      if (element.getAttribute(HIDDEN_ATTRIBUTE) !== CHANGELOG) {
        element.setAttribute(HIDDEN_ATTRIBUTE, CHANGELOG);
      }
    }
  }

  return {
    start() {
      if (observer !== null) {
        return;
      }
      observer = new window.MutationObserver(apply);
      observer.observe(document, { childList: true, subtree: true });
      apply();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      showAll();
    },
  };
}
