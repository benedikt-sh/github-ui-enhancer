import type { ApiErrorInfo } from '../../shared/errors.ts';
import { button, notice } from '../../ui/forms.ts';
import { describeApiError, isTokenError, uniqueErrors } from '../../ui/states.ts';

/** Warning shown above data that arrived only partially, null without errors. */
export function partialErrorNotice(
  errors: readonly ApiErrorInfo[],
  onOpenSettings: (() => void) | null,
): HTMLDivElement | null {
  if (errors.length === 0) {
    return null;
  }
  const showSettings = onOpenSettings && errors.some((error) => isTokenError(error.kind));
  const settings = showSettings
    ? [button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: onOpenSettings })]
    : [];
  return notice({
    variant: 'warning',
    message: uniqueErrors(errors).map(describeApiError).join(' '),
    actions: settings,
  });
}
