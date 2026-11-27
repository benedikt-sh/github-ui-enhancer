import { toApiErrorInfo } from '../shared/errors.ts';
import type { ApiErrorInfo } from '../shared/errors.ts';
import { h, safeUrl } from '../ui/dom.ts';
import { notice } from '../ui/forms.ts';
import { icon } from '../ui/octicons.ts';
import { describeApiError } from '../ui/states.ts';

export interface ErrorNoticeOptions {
  /** Replaces the generic description, e.g. for `invalid_request` where the message matters. */
  readonly title?: string;
  /** Extra sentence after the error message. */
  readonly note?: string;
}

/**
 * Shows the user facing description and the background's message. Messages crossing the
 * messaging boundary never contain a token, so they are safe to render.
 */
export function errorNotice(error: unknown, options: ErrorNoticeOptions = {}): HTMLDivElement {
  const info: ApiErrorInfo = toApiErrorInfo(error);
  const url = safeUrl(info.actionUrl);
  const link = url
    ? h(
        'a',
        { className: 'ghx-link', href: url, target: '_blank', rel: 'noopener noreferrer' },
        'Open on GitHub',
        icon('link-external'),
      )
    : null;
  return notice({
    variant: 'danger',
    title: options.title ?? describeApiError(info),
    message: [
      info.message ? h('span', { className: 'ghx-options__error-detail' }, info.message) : null,
      options.note ? h('span', { className: 'ghx-options__error-note' }, ` ${options.note}`) : null,
    ],
    actions: link ? [link] : [],
  });
}
