import type { RequestSender } from '../shared/messages.ts';
import { h } from '../ui/dom.ts';
import { button, notice } from '../ui/forms.ts';
import { errorNotice } from './error-notice.ts';

export interface MaintenanceDeps {
  readonly send: RequestSender;
}

export function maintenance(deps: MaintenanceDeps): HTMLDivElement {
  const status = h('div', { className: 'ghx-maintenance__status', 'aria-live': 'polite' });
  const clear = button({
    label: 'Clear cached data',
    icon: 'trash',
    onClick: () => void clearCache(),
  });
  const label = clear.querySelector('.ghx-btn__label');

  const setBusy = (busy: boolean): void => {
    clear.disabled = busy;
    if (label) {
      label.textContent = busy ? 'Clearing...' : 'Clear cached data';
    }
  };

  async function clearCache(): Promise<void> {
    setBusy(true);
    status.replaceChildren();
    try {
      await deps.send('cache.clear', {});
      status.replaceChildren(notice({ variant: 'success', message: 'Cached data cleared.' }));
    } catch (error) {
      status.replaceChildren(errorNotice(error));
    } finally {
      setBusy(false);
    }
  }

  return h(
    'div',
    { className: 'ghx-maintenance' },
    h(
      'p',
      null,
      'Repositories, pull requests and other data are cached to save API requests. Clear the ' +
        'cache if the dashboard shows outdated data. Tokens are kept.',
    ),
    h('div', { className: 'ghx-maintenance__actions' }, clear),
    status,
  );
}
