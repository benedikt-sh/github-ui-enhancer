import type { WidgetData } from '../../shared/data.ts';
import { STORAGE_KEYS } from '../../shared/storage.ts';
import type { KeyValueStore } from '../../shared/storage.ts';
import type { RecentRepoItem, RepoActivityKind, RepoRef } from '../../shared/types.ts';
import { findHeaderSlot, isInHeaderSlot, isLoggedIn } from '../mount/selectors.ts';
import type { Toggleable } from '../tweaks/apply-tweaks.ts';
import { createHeaderPinsView, PINS_ATTRIBUTE } from './header-pins-view.ts';
import type { HeaderPinsView } from './header-pins-view.ts';
import {
  addPin,
  defaultPins,
  isPinned,
  movePin,
  parsePins,
  parseRepo,
  removePin,
  samePins,
  serializePins,
  setRecent,
} from './pins-settings.ts';
import type { PinsSettings } from './pins-settings.ts';

/** Own code activity only, comments and reviews would pin repositories one merely visited. */
export const RECENT_KINDS: readonly RepoActivityKind[] = ['push', 'pull_request', 'create'];
export const RECENT_REFRESH_MS = 5 * 60_000;
export const SAVE_ERROR = 'Could not save your pins. Please try again.';

export interface HeaderPinsOptions {
  readonly document: Document;
  readonly window: Pick<typeof globalThis, 'MutationObserver'>;
  readonly data: Pick<WidgetData, 'repoIndex' | 'recentRepositories'>;
  /** `storage.sync`, the pins live under `STORAGE_KEYS.headerPins`. */
  readonly store: KeyValueStore;
  /** Reports changes of the stored pins, also from other tabs, returns an unsubscribe. */
  readonly subscribe?: (listener: (value: unknown) => void) => () => void;
  readonly now?: () => number;
  /**
   * Resolves once GitHub's React code has taken over the prerendered header, see
   * `whenPageSettled`. Inserting earlier makes React redraw the whole header. Defaults to now.
   */
  readonly settled?: Promise<void>;
}

/**
 * Quick links to repositories in GitHub's global header bar. GitHub re-renders the header on
 * soft navigations, so every DOM change checks whether the links are still in place.
 */
export function createHeaderPins(options: HeaderPinsOptions): Toggleable {
  const { document, window, data, store } = options;
  const now = options.now ?? Date.now;
  const settled = options.settled ?? Promise.resolve();
  let running = false;
  let ready = false;
  /** Bumped by `start` and `stop`, async results of an older run are dropped. */
  let generation = 0;
  let settings: PinsSettings | null = null;
  let recent: RepoRef | null = null;
  let recentFetchedAt: number | null = null;
  let recentLoading = false;
  let error: string | null = null;
  let pendingWrites = 0;
  let writes: Promise<void> = Promise.resolve();
  let view: HeaderPinsView | null = null;
  let observer: MutationObserver | null = null;
  let unsubscribe: (() => void) | null = null;

  function sync(): void {
    if (view !== null && isInHeaderSlot(view.root)) {
      return;
    }
    if (!isLoggedIn(document)) {
      if (document.readyState !== 'loading') {
        // Signing in reloads the page, so a logged-out page never needs the pins.
        observer?.disconnect();
      }
      return;
    }
    if (settings === null || !ready) {
      return;
    }
    const slot = findHeaderSlot(document, view?.root ?? null);
    removeTraces(slot === null ? null : view?.root ?? null);
    if (slot === null) {
      return;
    }
    view ??= createView();
    render();
    slot.parent.insertBefore(view.root, slot.before);
    refreshRecent();
  }

  function createView(): HeaderPinsView {
    return createHeaderPinsView({
      document,
      loadRepos: async () => (await data.repoIndex()).data,
      onAdd: (repo) => change((current) => addPin(current, repo)),
      onRemove: (repo) => change((current) => removePin(current, repo)),
      onMove: (repo, index) => change((current) => movePin(current, repo, index)),
      onRecentChange: (value) => change((current) => setRecent(current, value)),
      now,
    });
  }

  /** Turbo restores page snapshots with lifeless copies of the element. */
  function removeTraces(keep: Element | null): void {
    for (const element of document.querySelectorAll(`[${PINS_ATTRIBUTE}]`)) {
      if (element !== keep) {
        element.remove();
      }
    }
  }

  function render(): void {
    if (view === null || settings === null) {
      return;
    }
    const auto = settings.recent && recent !== null && !isPinned(settings, recent) ? recent : null;
    view.update({ settings, recent: auto, error });
  }

  function applySettings(next: PinsSettings): void {
    settings = next;
    render();
    sync();
    refreshRecent();
  }

  function change(update: (current: PinsSettings) => PinsSettings): void {
    const previous = settings;
    if (previous === null) {
      return;
    }
    const next = update(previous);
    if (samePins(previous, next)) {
      return;
    }
    error = null;
    applySettings(next);
    const run = generation;
    pendingWrites += 1;
    writes = writes
      .then(() => store.set(STORAGE_KEYS.headerPins, serializePins(next)))
      .catch(() => {
        if (run === generation && settings === next) {
          error = SAVE_ERROR;
          applySettings(previous);
        }
      })
      .finally(() => {
        pendingWrites -= 1;
      });
  }

  function onStored(value: unknown): void {
    // Echoes of the own writes arrive late and would briefly undo a newer change.
    if (pendingWrites > 0) {
      return;
    }
    const next = parsePins(value);
    if (settings === null || !samePins(settings, next)) {
      applySettings(next);
    }
  }

  function refreshRecent(): void {
    if (settings?.recent !== true || recentLoading) {
      return;
    }
    const time = now();
    if (recentFetchedAt !== null && time - recentFetchedAt < RECENT_REFRESH_MS) {
      return;
    }
    recentFetchedAt = time;
    recentLoading = true;
    const run = generation;
    Promise.resolve()
      .then(() => data.recentRepositories({ kinds: RECENT_KINDS, limit: 1 }))
      .then(
        (result) => latestRepo(result.data),
        () => null,
      )
      .then((repo) => {
        if (run === generation) {
          recentLoading = false;
          recent = repo;
          render();
        }
      });
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      refreshRecent();
    }
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      generation += 1;
      const run = generation;
      unsubscribe = options.subscribe?.(onStored) ?? null;
      Promise.resolve()
        .then(() => store.get(STORAGE_KEYS.headerPins))
        .then(parsePins, defaultPins)
        .then((loaded) => {
          if (run === generation && settings === null) {
            applySettings(loaded);
          }
        });
      document.addEventListener('visibilitychange', onVisibilityChange);
      void settled.then(() => {
        if (run === generation) {
          ready = true;
          sync();
        }
      });
      observer = new window.MutationObserver(sync);
      observer.observe(document, { childList: true, subtree: true });
      sync();
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;
      generation += 1;
      observer?.disconnect();
      observer = null;
      unsubscribe?.();
      unsubscribe = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      ready = false;
      view?.dispose();
      view = null;
      removeTraces(null);
      settings = null;
      recent = null;
      recentFetchedAt = null;
      recentLoading = false;
      error = null;
    },
  };
}

function latestRepo(items: readonly RecentRepoItem[]): RepoRef | null {
  const item = items[0];
  return item === undefined ? null : parseRepo(item.repo);
}
