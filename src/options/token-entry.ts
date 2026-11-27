import type { RequestSender } from '../shared/messages.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import { appendChildren, h } from '../ui/dom.ts';
import type { Child } from '../ui/dom.ts';
import { button, formField, textInput } from '../ui/forms.ts';
import type { ButtonOptions } from '../ui/forms.ts';
import { formatAbsoluteTime, relativeTime } from '../ui/time.ts';
import { errorNotice } from './error-notice.ts';
import { describeExpiry, describeStatus } from './token-status.ts';

export interface TokenEntryDeps {
  readonly send: RequestSender;
  readonly now: () => Date;
  /** Called after the background removed the token. */
  readonly onRemoved: (id: string) => void;
  /** Called after a failed action, the stored token may have changed anyway. */
  readonly onStale: () => void;
}

export interface TokenEntryView {
  readonly id: string;
  readonly element: HTMLLIElement;
  /** Shows new data from the background, keeps an open form and the last error. */
  update(info: TokenInfo): void;
}

type Mode = 'view' | 'edit-owner' | 'confirm-remove';
type BusyAction = 'validate' | 'owner' | 'remove';

const BUSY_LABELS: Record<BusyAction, string> = {
  validate: 'Checking...',
  owner: 'Saving...',
  remove: 'Removing...',
};

function ownerName(info: TokenInfo): string {
  return info.owner ?? 'this token';
}

export function tokenEntry(initial: TokenInfo, deps: TokenEntryDeps): TokenEntryView {
  const { send, now } = deps;
  let info = initial;
  let mode: Mode = 'view';
  let busy: BusyAction | null = null;
  let error: unknown = null;
  let ownerDraft = '';

  const element = h('li', { className: 'ghx-token' });

  const actionButton = (
    action: string,
    label: string,
    options: Omit<ButtonOptions, 'label' | 'disabled'>,
    busyFor?: BusyAction,
  ): HTMLButtonElement => {
    const result = button({
      size: 'small',
      ...options,
      label: busy !== null && busy === busyFor ? BUSY_LABELS[busy] : label,
      disabled: busy !== null,
    });
    result.dataset['action'] = action;
    return result;
  };

  const run = async (
    action: BusyAction,
    task: () => Promise<void>,
    focusAfter: string,
  ): Promise<void> => {
    busy = action;
    error = null;
    render();
    try {
      await task();
    } catch (caught) {
      error = caught;
      deps.onStale();
    } finally {
      busy = null;
    }
    render(focusAfter);
  };

  const validate = (): Promise<void> =>
    run(
      'validate',
      async () => {
        info = await send('tokens.validate', { id: info.id });
      },
      'validate',
    );

  const saveOwner = (): Promise<void> => {
    const value = ownerDraft.trim();
    return run(
      'owner',
      async () => {
        info = await send('tokens.setOwner', { id: info.id, owner: value === '' ? null : value });
        mode = 'view';
      },
      'owner',
    );
  };

  const remove = (): Promise<void> =>
    run(
      'remove',
      async () => {
        mode = 'view';
        await send('tokens.remove', { id: info.id });
        deps.onRemoved(info.id);
      },
      'remove',
    );

  const switchMode = (next: Mode, focus: string): void => {
    mode = next;
    error = null;
    render(focus);
  };

  const ownerLine = (): Child[] => {
    if (info.owner === null) {
      return [
        h(
          'span',
          { className: 'ghx-token__owner ghx-token__owner--unknown' },
          'Owner unknown - set it manually',
        ),
      ];
    }
    return [
      h('span', { className: 'ghx-token__owner' }, info.owner),
      info.ownerSource === null
        ? null
        : h('span', { className: 'ghx-token__owner-source' }, info.ownerSource),
    ];
  };

  const meta = (): HTMLUListElement => {
    const expiry = describeExpiry(info, now());
    return h(
      'ul',
      { className: 'ghx-token__meta' },
      h(
        'li',
        { className: 'ghx-token__meta-item' },
        info.login === null ? 'Account unknown' : ['Account ', h('strong', null, info.login)],
      ),
      h(
        'li',
        { className: ['ghx-token__meta-item', 'ghx-token__expiry', `ghx-tone--${expiry.tone}`] },
        expiry.at === null
          ? expiry.text
          : h(
              'time',
              { datetime: expiry.at.toISOString(), title: formatAbsoluteTime(expiry.at) },
              expiry.text,
            ),
      ),
      h(
        'li',
        { className: 'ghx-token__meta-item' },
        info.lastCheckedAt === null
          ? 'Never checked'
          : ['Last checked ', relativeTime(info.lastCheckedAt, now())],
      ),
      h(
        'li',
        { className: 'ghx-token__meta-item' },
        'Token ending in ',
        h('code', { className: 'ghx-token__hint' }, `...${info.hint}`),
      ),
    );
  };

  const viewActions = (): HTMLDivElement =>
    h(
      'div',
      { className: 'ghx-token__actions' },
      actionButton(
        'validate',
        'Check again',
        { icon: 'sync', onClick: () => void validate() },
        'validate',
      ),
      actionButton('owner', 'Set owner', {
        icon: 'gear',
        onClick: () => {
          ownerDraft = info.ownerSource === 'manual' && info.owner !== null ? info.owner : '';
          switchMode('edit-owner', 'owner-input');
        },
      }),
      actionButton('remove', 'Remove', {
        icon: 'trash',
        variant: 'danger',
        onClick: () => switchMode('confirm-remove', 'confirm-remove'),
      }),
    );

  const ownerForm = (): HTMLFormElement => {
    const input = textInput({
      value: ownerDraft,
      placeholder: 'Detect automatically',
      autocomplete: 'off',
      disabled: busy !== null,
      onInput: (value) => {
        ownerDraft = value;
      },
    });
    input.dataset['action'] = 'owner-input';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && busy === null) {
        event.preventDefault();
        switchMode('view', 'owner');
      }
    });
    return h(
      'form',
      {
        className: 'ghx-token__owner-form',
        on: {
          submit: (event) => {
            event.preventDefault();
            if (busy === null) {
              void saveOwner();
            }
          },
        },
      },
      formField({
        label: 'Resource owner',
        control: input,
        hint: 'Account or organization the token was created for. Leave empty to detect it.',
      }),
      h(
        'div',
        { className: 'ghx-token__form-actions' },
        actionButton('owner', 'Save owner', { type: 'submit', variant: 'primary' }, 'owner'),
        actionButton('cancel-owner', 'Cancel', { onClick: () => switchMode('view', 'owner') }),
      ),
    );
  };

  const removeConfirmation = (): HTMLDivElement =>
    h(
      'div',
      { className: 'ghx-token__confirm', role: 'group', 'aria-label': 'Confirm removal' },
      h(
        'p',
        { className: 'ghx-token__confirm-text' },
        `Remove the token for ${ownerName(info)}? Its data will no longer be loaded.`,
      ),
      h(
        'div',
        { className: 'ghx-token__form-actions' },
        actionButton(
          'confirm-remove',
          'Remove token',
          { variant: 'danger', onClick: () => void remove() },
          'remove',
        ),
        actionButton('cancel-remove', 'Cancel', { onClick: () => switchMode('view', 'remove') }),
      ),
    );

  /** Without an explicit target, focus stays on the control it was on before rendering. */
  function render(focus?: string): void {
    const focused = document.activeElement;
    const target =
      focus ??
      (focused instanceof HTMLElement && element.contains(focused)
        ? focused.dataset['action']
        : undefined);
    const status = describeStatus(info.status);
    element.dataset['id'] = info.id;
    element.dataset['status'] = info.status;
    element.setAttribute('aria-busy', String(busy !== null));
    element.replaceChildren();
    appendChildren(element, [
      h(
        'div',
        { className: 'ghx-token__header' },
        h(
          'div',
          { className: 'ghx-token__identity' },
          ownerLine(),
          h(
            'span',
            { className: ['ghx-token-badge', `ghx-token-badge--${status.tone}`] },
            status.label,
          ),
        ),
        mode === 'view' ? viewActions() : null,
      ),
      h('p', { className: 'ghx-token__explanation' }, status.explanation),
      meta(),
      mode === 'edit-owner' ? ownerForm() : null,
      mode === 'confirm-remove' ? removeConfirmation() : null,
      error === null ? null : errorNotice(error),
    ]);
    if (target !== undefined) {
      element.querySelector<HTMLElement>(`[data-action="${target}"]`)?.focus();
    }
  }

  render();

  return {
    id: initial.id,
    element,
    update(next) {
      info = next;
      render();
    },
  };
}
