import { h, uniqueId } from './dom.ts';
import type { Child, ClassValue } from './dom.ts';
import { icon } from './octicons.ts';
import type { IconName } from './octicons.ts';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'invisible';
export type ButtonSize = 'small' | 'medium';

export interface ButtonOptions {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shown before the label. */
  readonly icon?: IconName;
  /** `submit` only inside forms, everything else stays a plain button. */
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  readonly title?: string;
  readonly className?: ClassValue;
  readonly onClick?: (event: MouseEvent) => void;
}

function buttonClasses(variant: ButtonVariant, size: ButtonSize, extra: ClassValue): ClassValue {
  return ['ghx-btn', `ghx-btn--${variant}`, size === 'small' && 'ghx-btn--small', extra];
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const { variant = 'default', size = 'medium' } = options;
  return h(
    'button',
    {
      type: options.type ?? 'button',
      className: buttonClasses(variant, size, options.className),
      disabled: options.disabled,
      title: options.title,
      on: options.onClick ? { click: options.onClick } : undefined,
    },
    options.icon ? icon(options.icon) : null,
    h('span', { className: 'ghx-btn__label' }, options.label),
  );
}

export interface IconButtonOptions {
  readonly icon: IconName;
  /** Accessible name and tooltip, icon buttons have no visible text. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  /** Renders a toggle button with `aria-pressed`. */
  readonly pressed?: boolean;
  readonly className?: ClassValue;
  readonly onClick?: (event: MouseEvent) => void;
}

export function iconButton(options: IconButtonOptions): HTMLButtonElement {
  const { variant = 'invisible', size = 'medium' } = options;
  return h(
    'button',
    {
      type: 'button',
      className: buttonClasses(variant, size, ['ghx-btn--icon', options.className]),
      'aria-label': options.label,
      'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
      title: options.label,
      disabled: options.disabled,
      on: options.onClick ? { click: options.onClick } : undefined,
    },
    icon(options.icon),
  );
}

export interface TextInputOptions {
  readonly value?: string;
  readonly type?: 'text' | 'search' | 'url' | 'number' | 'password';
  readonly name?: string;
  readonly id?: string;
  readonly placeholder?: string;
  /** Needed when the input is not wrapped in a `formField`. */
  readonly ariaLabel?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autocomplete?: string;
  readonly className?: ClassValue;
  readonly onInput?: (value: string, event: Event) => void;
  readonly onChange?: (value: string, event: Event) => void;
}

export function textInput(options: TextInputOptions = {}): HTMLInputElement {
  const input = h('input', {
    type: options.type ?? 'text',
    className: ['ghx-input', options.className],
    name: options.name,
    id: options.id,
    placeholder: options.placeholder,
    'aria-label': options.ariaLabel,
    required: options.required,
    disabled: options.disabled,
    autocomplete: options.autocomplete,
    spellcheck: 'false',
  });
  input.value = options.value ?? '';
  const { onInput, onChange } = options;
  if (onInput) {
    input.addEventListener('input', (event) => onInput(input.value, event));
  }
  if (onChange) {
    input.addEventListener('change', (event) => onChange(input.value, event));
  }
  return input;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectOptions {
  readonly options: readonly SelectOption[];
  readonly value?: string;
  readonly name?: string;
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: ClassValue;
  readonly onChange?: (value: string, event: Event) => void;
}

export function select(options: SelectOptions): HTMLSelectElement {
  const element = h(
    'select',
    {
      className: ['ghx-select', options.className],
      name: options.name,
      id: options.id,
      'aria-label': options.ariaLabel,
      disabled: options.disabled,
    },
    options.options.map((option) =>
      h('option', { value: option.value, disabled: option.disabled }, option.label),
    ),
  );
  if (options.value !== undefined) {
    element.value = options.value;
  }
  const { onChange } = options;
  if (onChange) {
    element.addEventListener('change', (event) => onChange(element.value, event));
  }
  return element;
}

export interface CheckboxOptions {
  readonly label: string;
  readonly checked?: boolean;
  readonly name?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onChange?: (checked: boolean, event: Event) => void;
}

export interface Checkbox {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
}

export function checkbox(options: CheckboxOptions): Checkbox {
  const id = uniqueId('ghx-checkbox');
  const hintId = options.hint ? `${id}-hint` : undefined;
  const input = h('input', {
    type: 'checkbox',
    className: 'ghx-checkbox__input',
    id,
    name: options.name,
    disabled: options.disabled,
    'aria-describedby': hintId,
  });
  input.checked = options.checked ?? false;
  const { onChange } = options;
  if (onChange) {
    input.addEventListener('change', (event) => onChange(input.checked, event));
  }
  const root = h(
    'div',
    { className: 'ghx-checkbox' },
    input,
    h('label', { className: 'ghx-checkbox__label', for: id }, options.label),
    options.hint ? h('p', { className: 'ghx-hint', id: hintId }, options.hint) : null,
  );
  return { root, input };
}

export interface FormFieldOptions {
  readonly label: string;
  readonly control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  readonly hint?: Child;
  /** Validation message, marks the control as invalid. */
  readonly error?: string | null;
  readonly required?: boolean;
}

export function formField(options: FormFieldOptions): HTMLDivElement {
  const { control } = options;
  if (control.id === '') {
    control.id = uniqueId('ghx-field');
  }
  const hintId = options.hint ? `${control.id}-hint` : null;
  const errorId = options.error ? `${control.id}-error` : null;
  const describedBy = [hintId, errorId].filter((id) => id !== null).join(' ');
  if (describedBy !== '') {
    control.setAttribute('aria-describedby', describedBy);
  }
  if (errorId) {
    control.setAttribute('aria-invalid', 'true');
  }
  if (options.required) {
    control.required = true;
  }
  return h(
    'div',
    { className: ['ghx-field', errorId && 'ghx-field--invalid'] },
    h(
      'label',
      { className: 'ghx-field__label', for: control.id },
      options.label,
      options.required
        ? h('span', { className: 'ghx-field__required', 'aria-hidden': 'true' }, ' *')
        : null,
    ),
    control,
    hintId ? h('p', { className: 'ghx-hint', id: hintId }, options.hint) : null,
    errorId
      ? h('p', { className: 'ghx-field__error', id: errorId }, icon('alert'), options.error)
      : null,
  );
}

export type NoticeVariant = 'info' | 'success' | 'warning' | 'danger';

const NOTICE_ICONS: Record<NoticeVariant, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert',
  danger: 'stop',
};

export interface NoticeOptions {
  readonly variant?: NoticeVariant;
  readonly title?: string;
  readonly message: Child;
  /** Buttons or links shown below the message. */
  readonly actions?: readonly Node[];
}

export function notice(options: NoticeOptions): HTMLDivElement {
  const variant = options.variant ?? 'info';
  const actions = options.actions ?? [];
  return h(
    'div',
    {
      className: ['ghx-notice', `ghx-notice--${variant}`],
      role: variant === 'danger' || variant === 'warning' ? 'alert' : 'status',
    },
    icon(NOTICE_ICONS[variant], { className: 'ghx-notice__icon' }),
    h(
      'div',
      { className: 'ghx-notice__body' },
      options.title ? h('strong', { className: 'ghx-notice__title' }, options.title) : null,
      h('div', { className: 'ghx-notice__message' }, options.message),
      actions.length > 0 ? h('div', { className: 'ghx-notice__actions' }, actions) : null,
    ),
  );
}
