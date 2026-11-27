import { toApiErrorInfo } from '../shared/errors.ts';
import type { RequestSender } from '../shared/messages.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import { h } from '../ui/dom.ts';
import { emptyState, errorState, loadingState } from '../ui/states.ts';
import { tokenEntry } from './token-entry.ts';
import type { TokenEntryView } from './token-entry.ts';

export interface TokenListDeps {
  readonly send: RequestSender;
  readonly now: () => Date;
}

export interface TokenListView {
  readonly element: HTMLDivElement;
  /** Shows the loading state until the list arrives, or an error state with retry. */
  load(): Promise<void>;
  /**
   * Reloads without loading state. A failure keeps the shown entries, because the error that
   * triggered the refresh is already visible.
   */
  refresh(): Promise<void>;
  /** Shows a token the page received outside of a list request, e.g. a newly added one. */
  upsert(info: TokenInfo): void;
}

export function tokenList(deps: TokenListDeps): TokenListView {
  const { send, now } = deps;
  const element = h('div', { className: 'ghx-token-list' });
  const list = h('ul', { className: 'ghx-token-list__items', 'aria-label': 'Access tokens' });
  const views = new Map<string, TokenEntryView>();
  let request = 0;

  const showEmptyIfNeeded = (): void => {
    if (views.size === 0) {
      element.replaceChildren(
        emptyState({
          title: 'No tokens yet',
          description: 'Add a fine-grained token below so the dashboard can read data.',
          icon: 'lock',
        }),
      );
    } else if (list.parentNode !== element) {
      element.replaceChildren(list);
    }
  };

  const createView = (info: TokenInfo): TokenEntryView =>
    tokenEntry(info, {
      send,
      now,
      onRemoved: (id) => {
        views.get(id)?.element.remove();
        views.delete(id);
        showEmptyIfNeeded();
      },
      onStale: () => void view.refresh(),
    });

  const setTokens = (tokens: readonly TokenInfo[]): void => {
    const ids = new Set(tokens.map((token) => token.id));
    for (const [id, entry] of views) {
      if (!ids.has(id)) {
        entry.element.remove();
        views.delete(id);
      }
    }
    for (const token of tokens) {
      const existing = views.get(token.id);
      const entry = existing ?? createView(token);
      if (existing) {
        existing.update(token);
      } else {
        views.set(token.id, entry);
      }
      // Appending an attached node moves it, which keeps the order of the background.
      list.append(entry.element);
    }
    showEmptyIfNeeded();
  };

  const fetchTokens = async (quiet: boolean): Promise<void> => {
    request += 1;
    const current = request;
    if (!quiet) {
      element.replaceChildren(loadingState('Loading tokens...'));
    }
    try {
      const tokens = await send('tokens.list', {});
      if (current === request) {
        setTokens(tokens);
      }
    } catch (error) {
      if (current === request && !quiet) {
        element.replaceChildren(
          errorState([toApiErrorInfo(error)], {
            title: 'Could not load tokens',
            onRetry: () => void view.load(),
          }),
        );
      }
    }
  };

  const view: TokenListView = {
    element,
    load: () => fetchTokens(false),
    refresh: () => fetchTokens(true),
    upsert(info) {
      const existing = views.get(info.id);
      if (existing) {
        existing.update(info);
        return;
      }
      const entry = createView(info);
      views.set(info.id, entry);
      list.append(entry.element);
      showEmptyIfNeeded();
    },
  };
  return view;
}
