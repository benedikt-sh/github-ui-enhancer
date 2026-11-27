import { toApiErrorInfo } from '../shared/errors.ts';
import type { RequestSender } from '../shared/messages.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import { h } from '../ui/dom.ts';
import { button, formField, notice, textInput } from '../ui/forms.ts';
import { errorNotice } from './error-notice.ts';

export interface AddTokenFormDeps {
  readonly send: RequestSender;
  readonly onAdded: (info: TokenInfo) => void;
  /** The background may have stored the token although the request failed. */
  readonly onStale: () => void;
}

const STORED_ANYWAY_NOTE =
  'If the token was saved anyway, it is listed as not checked yet. Use "Check again" later.';

export function addTokenForm(deps: AddTokenFormDeps): HTMLFormElement {
  const secretInput = textInput({
    type: 'password',
    name: 'secret',
    placeholder: 'github_pat_...',
    autocomplete: 'off',
    required: true,
  });
  const ownerInput = textInput({ name: 'owner', placeholder: 'octo-org', autocomplete: 'off' });
  const submit = button({ label: 'Add token', type: 'submit', variant: 'primary', icon: 'plus' });
  const submitLabel = submit.querySelector('.ghx-btn__label');
  const status = h('div', { className: 'ghx-add-token__status', 'aria-live': 'polite' });
  let busy = false;

  const setBusy = (value: boolean): void => {
    busy = value;
    secretInput.disabled = value;
    ownerInput.disabled = value;
    submit.disabled = value;
    if (submitLabel) {
      submitLabel.textContent = value ? 'Adding...' : 'Add token';
    }
  };

  const add = async (): Promise<void> => {
    const owner = ownerInput.value.trim();
    const params = { secret: secretInput.value, ...(owner === '' ? {} : { owner }) };
    setBusy(true);
    status.replaceChildren();
    try {
      const info = await deps.send('tokens.add', params);
      secretInput.value = '';
      ownerInput.value = '';
      status.replaceChildren(
        notice({
          variant: 'success',
          title: 'Token added',
          message: `The token ending in ...${info.hint} was added${
            info.owner === null ? '' : ` for ${info.owner}`
          }.`,
        }),
      );
      deps.onAdded(info);
    } catch (error) {
      // `invalid_request` means the background refused the token before storing it, so the user
      // can correct the input. Any other failure happens after the token was stored.
      if (toApiErrorInfo(error).kind === 'invalid_request') {
        status.replaceChildren(errorNotice(error, { title: 'The token was not added.' }));
      } else {
        secretInput.value = '';
        status.replaceChildren(errorNotice(error, { note: STORED_ANYWAY_NOTE }));
        deps.onStale();
      }
    } finally {
      setBusy(false);
    }
    secretInput.focus();
  };

  return h(
    'form',
    {
      className: 'ghx-add-token',
      autocomplete: 'off',
      on: {
        submit: (event) => {
          event.preventDefault();
          if (!busy) {
            void add();
          }
        },
      },
    },
    formField({
      label: 'Fine-grained personal access token',
      control: secretInput,
      required: true,
      hint: 'Stored only in this browser profile and never shown again after saving.',
    }),
    formField({
      label: 'Resource owner (optional)',
      control: ownerInput,
      hint: 'Leave empty to detect it from the repositories the token can read.',
    }),
    h('div', { className: 'ghx-add-token__actions' }, submit),
    status,
  );
}
