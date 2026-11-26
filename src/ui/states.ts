import type { ApiErrorInfo, ApiErrorKind } from '../shared/errors.ts';
import { h, safeUrl } from './dom.ts';
import type { Child } from './dom.ts';
import { button } from './forms.ts';
import { icon } from './octicons.ts';
import type { IconName } from './octicons.ts';

export function loadingState(label = 'Loading...'): HTMLDivElement {
  return h(
    'div',
    { className: 'ghx-state ghx-state--loading', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'ghx-spinner', 'aria-hidden': 'true' }),
    h('span', { className: 'ghx-state__text' }, label),
  );
}

export interface EmptyStateOptions {
  readonly title: string;
  readonly description?: Child;
  readonly icon?: IconName;
  readonly actions?: readonly Node[];
}

export function emptyState(options: EmptyStateOptions): HTMLDivElement {
  const actions = options.actions ?? [];
  return h(
    'div',
    { className: 'ghx-state ghx-state--empty' },
    options.icon ? icon(options.icon, { className: 'ghx-state__icon' }) : null,
    h('p', { className: 'ghx-state__title' }, options.title),
    options.description
      ? h('p', { className: 'ghx-state__description' }, options.description)
      : null,
    actions.length > 0 ? h('div', { className: 'ghx-state__actions' }, actions) : null,
  );
}

const TOKEN_ERROR_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  'unauthorized',
  'forbidden',
  'no_tokens',
  'no_token_for_owner',
]);

/** Errors the user fixes on the options page by adding, replacing or extending a token. */
export function isTokenError(kind: ApiErrorKind): boolean {
  return TOKEN_ERROR_KINDS.has(kind);
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.ceil(seconds / 60));
  return `${value} minute${value === 1 ? '' : 's'}`;
}

/** A user facing sentence per error kind. Never includes the raw message. */
export function describeApiError(error: ApiErrorInfo): string {
  const tokenFor = error.owner ? `The token for ${error.owner}` : 'A token';
  switch (error.kind) {
    case 'unauthorized':
      return `${tokenFor} is invalid or has expired.`;
    case 'forbidden':
      return `${tokenFor} lacks the permissions needed for this widget.`;
    case 'sso_required':
      return error.owner
        ? `${error.owner} requires single sign-on authorization for this token.`
        : 'An organization requires single sign-on authorization for this token.';
    case 'pending_approval':
      return error.owner
        ? `The token for ${error.owner} is waiting for approval by an organization owner.`
        : 'A token is waiting for approval by an organization owner.';
    case 'rate_limited':
      return error.retryAfter === undefined
        ? 'The GitHub API rate limit is exhausted.'
        : `The GitHub API rate limit is exhausted. Try again in ${minutes(error.retryAfter)}.`;
    case 'not_found':
      return 'Not found. It may not exist or no token can access it.';
    case 'network':
      return 'GitHub could not be reached. Check your connection.';
    case 'no_tokens':
      return 'No access token is configured yet.';
    case 'no_token_for_owner':
      return error.owner ? `No token is configured for ${error.owner}.` : 'No token is configured.';
    case 'blocked_write':
      return 'A request that would change data on GitHub was blocked.';
    case 'invalid_response':
      return 'GitHub returned an unexpected response.';
    case 'invalid_request':
      return 'The request was invalid.';
    case 'not_allowed':
      return 'This request is not allowed.';
    case 'internal':
      return 'Something went wrong.';
  }
}

const ACTION_LABELS: Partial<Record<ApiErrorKind, string>> = {
  sso_required: 'Authorize token',
  pending_approval: 'View request',
};

export interface ErrorStateOptions {
  readonly title?: string;
  /** Shown once if any error is token related. */
  readonly onOpenSettings?: () => void;
  readonly onRetry?: () => void;
}

function errorItem(error: ApiErrorInfo): HTMLLIElement {
  const url = safeUrl(error.actionUrl);
  return h(
    'li',
    { className: 'ghx-error', dataset: { kind: error.kind } },
    h('span', { className: 'ghx-error__text' }, describeApiError(error)),
    error.message ? h('span', { className: 'ghx-error__detail' }, error.message) : null,
    url
      ? h(
          'a',
          {
            className: 'ghx-link ghx-error__action',
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          ACTION_LABELS[error.kind] ?? 'Open on GitHub',
          icon('link-external'),
        )
      : null,
  );
}

export function errorState(
  errors: readonly ApiErrorInfo[],
  options: ErrorStateOptions = {},
): HTMLDivElement {
  const { onOpenSettings, onRetry } = options;
  const showSettings = onOpenSettings && errors.some((error) => isTokenError(error.kind));
  const actions = [
    showSettings
      ? button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: onOpenSettings })
      : null,
    onRetry ? button({ label: 'Retry', icon: 'sync', size: 'small', onClick: onRetry }) : null,
  ].filter((action) => action !== null);
  return h(
    'div',
    { className: 'ghx-state ghx-state--error', role: 'alert' },
    icon('alert', { className: 'ghx-state__icon' }),
    h('p', { className: 'ghx-state__title' }, options.title ?? 'Could not load data'),
    errors.length > 0 ? h('ul', { className: 'ghx-errors' }, errors.map(errorItem)) : null,
    actions.length > 0 ? h('div', { className: 'ghx-state__actions' }, actions) : null,
  );
}
