import type { WidgetData } from '../../shared/data.ts';
import type { Toggleable } from '../tweaks/apply-tweaks.ts';
import { openQuickSwitcherDialog } from './dialog.ts';
import type { OpenUrl, QuickSwitcherDialog } from './dialog.ts';
import { createDoubleShiftDetector } from './double-shift.ts';
import { createRepoStore } from './repo-store.ts';
import { buildResults } from './results.ts';

export type { OpenUrl } from './dialog.ts';

export interface QuickSwitcherWindow
  extends Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout'> {
  open(url: string, target: string, features: string): unknown;
  readonly location: { assign(url: string): void };
}

export interface QuickSwitcherOptions {
  readonly document: Document;
  readonly window: QuickSwitcherWindow;
  readonly data: Pick<WidgetData, 'repoIndex' | 'recentRepositories'>;
  readonly now?: () => number;
  /** Defaults to navigating the current tab or opening a new one. */
  readonly openUrl?: OpenUrl;
  /** Opens the extension settings, offered when tokens are missing or broken. */
  readonly openOptions?: () => void;
}

export function defaultOpenUrl(win: QuickSwitcherWindow): OpenUrl {
  return (url, newTab) => {
    if (newTab) {
      win.open(url, '_blank', 'noopener,noreferrer');
    } else {
      win.location.assign(url);
    }
  };
}

/**
 * Opens a search over all repositories when Shift is pressed twice, on every GitHub page and
 * also while typing in a text field. The Shift presses themselves are never prevented.
 */
export function createQuickSwitcher(options: QuickSwitcherOptions): Toggleable {
  const { document, window, data, openOptions } = options;
  const now = options.now ?? Date.now;
  const openUrl = options.openUrl ?? defaultOpenUrl(window);
  // Kept across stop and start, the repositories stay valid for the whole page.
  const store = createRepoStore({ data, now });
  const detector = createDoubleShiftDetector(now);
  let running = false;
  let dialog: QuickSwitcherDialog | null = null;
  let unsubscribe: (() => void) | null = null;

  function onKeyDown(event: KeyboardEvent): void {
    if (detector.keydown(event)) {
      open();
    }
  }

  function resetDetector(): void {
    detector.reset();
  }

  function open(): void {
    if (dialog !== null && dialog.root.isConnected) {
      dialog.focus();
      return;
    }
    // GitHub's Turbo navigation swaps the body and takes a still open dialog with it.
    dialog?.close();
    const instance = openQuickSwitcherDialog({
      document,
      window,
      results: (query) => buildResults(store.snapshot(), query),
      openUrl,
      onRetry: () => store.refresh(true),
      openOptions,
      onClose: () => {
        if (dialog === instance) {
          unsubscribe?.();
          unsubscribe = null;
          dialog = null;
        }
      },
    });
    dialog = instance;
    unsubscribe = store.subscribe(() => instance.update());
    store.refresh();
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      // Capture phase, so handlers of GitHub that stop the event cannot hide a Shift press.
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('mousedown', resetDetector, true);
      window.addEventListener('blur', resetDetector);
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', resetDetector, true);
      window.removeEventListener('blur', resetDetector);
      detector.reset();
      dialog?.close();
    },
  };
}
