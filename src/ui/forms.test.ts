import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { h } from './dom.ts';
import {
  button,
  checkbox,
  formField,
  iconButton,
  notice,
  select,
  textInput,
} from './forms.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

function typeInto(input: HTMLInputElement, value: string, eventType: 'input' | 'change'): void {
  input.value = value;
  input.dispatchEvent(new Event(eventType, { bubbles: true }));
}

describe('button', () => {
  it('renders a default medium button of type button', () => {
    const element = button({ label: 'Save' });

    assert.equal(element.type, 'button');
    assert.equal(element.className, 'ghx-btn ghx-btn--default');
    assert.equal(element.textContent, 'Save');
    assert.equal(element.disabled, false);
    assert.equal(element.querySelector('svg'), null);
  });

  it('supports variants, sizes, icons, submit type and extra classes', () => {
    for (const variant of ['primary', 'danger', 'invisible'] as const) {
      assert.ok(button({ label: 'x', variant }).classList.contains(`ghx-btn--${variant}`));
    }
    const element = button({
      label: 'Add',
      icon: 'plus',
      size: 'small',
      type: 'submit',
      title: 'Add widget',
      className: 'extra',
      disabled: true,
    });

    assert.equal(element.type, 'submit');
    assert.ok(element.classList.contains('ghx-btn--small'));
    assert.ok(element.classList.contains('extra'));
    assert.equal(element.title, 'Add widget');
    assert.equal(element.disabled, true);
    assert.ok(element.querySelector('svg.ghx-icon--plus'));
  });

  it('calls the click handler', () => {
    let clicked = 0;
    button({ label: 'Go', onClick: () => clicked++ }).click();

    assert.equal(clicked, 1);
  });
});

describe('iconButton', () => {
  it('renders an invisible button labeled for assistive technology', () => {
    const element = iconButton({ icon: 'gear', label: 'Configure' });

    assert.equal(element.type, 'button');
    assert.equal(element.getAttribute('aria-label'), 'Configure');
    assert.equal(element.title, 'Configure');
    assert.equal(element.hasAttribute('aria-pressed'), false);
    assert.equal(element.className, 'ghx-btn ghx-btn--invisible ghx-btn--icon');
    assert.equal(element.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });

  it('supports toggles, variants, sizes, disabled and clicks', () => {
    let clicked = 0;
    const element = iconButton({
      icon: 'trash',
      label: 'Remove',
      variant: 'danger',
      size: 'small',
      pressed: false,
      disabled: false,
      className: 'x',
      onClick: () => clicked++,
    });
    element.click();

    assert.equal(element.getAttribute('aria-pressed'), 'false');
    assert.ok(element.classList.contains('ghx-btn--danger'));
    assert.ok(element.classList.contains('ghx-btn--small'));
    assert.equal(clicked, 1);
    const pressed = iconButton({ icon: 'eye', label: 'x', pressed: true });
    assert.equal(pressed.getAttribute('aria-pressed'), 'true');
  });
});

describe('textInput', () => {
  it('renders an empty text input by default', () => {
    const input = textInput();

    assert.equal(input.type, 'text');
    assert.equal(input.className, 'ghx-input');
    assert.equal(input.value, '');
  });

  it('applies options and reports input and change values', () => {
    const inputs: string[] = [];
    const changes: string[] = [];
    const input = textInput({
      value: 'abc',
      type: 'search',
      name: 'q',
      id: 'query',
      placeholder: 'Find',
      ariaLabel: 'Search',
      required: true,
      disabled: false,
      autocomplete: 'off',
      className: 'wide',
      onInput: (value) => inputs.push(value),
      onChange: (value) => changes.push(value),
    });

    assert.equal(input.value, 'abc');
    assert.equal(input.type, 'search');
    assert.equal(input.name, 'q');
    assert.equal(input.id, 'query');
    assert.equal(input.placeholder, 'Find');
    assert.equal(input.getAttribute('aria-label'), 'Search');
    assert.equal(input.required, true);
    assert.equal(input.getAttribute('autocomplete'), 'off');
    assert.ok(input.classList.contains('wide'));

    typeInto(input, 'abcd', 'input');
    typeInto(input, 'abcde', 'change');

    assert.deepEqual(inputs, ['abcd']);
    assert.deepEqual(changes, ['abcde']);
  });

  it('keeps markup in values as plain text', () => {
    const input = textInput({ value: '"><script>x</script>' });

    assert.equal(input.value, '"><script>x</script>');
    assert.equal(input.getAttribute('value'), null);
  });
});

describe('select', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', disabled: true },
    { value: 'c', label: 'Gamma' },
  ];

  it('renders the options and selects the given value', () => {
    const element = select({
      options,
      value: 'c',
      name: 'n',
      id: 's',
      ariaLabel: 'Pick',
      className: 'x',
    });

    assert.equal(element.className, 'ghx-select x');
    assert.equal(element.options.length, 3);
    assert.equal(element.options[1]?.disabled, true);
    assert.equal(element.options[0]?.textContent, 'Alpha');
    assert.equal(element.value, 'c');
    assert.equal(element.getAttribute('aria-label'), 'Pick');
  });

  it('defaults to the first option and reports changes', () => {
    const changes: string[] = [];
    const element = select({ options, disabled: false, onChange: (value) => changes.push(value) });

    assert.equal(element.value, 'a');
    element.value = 'c';
    element.dispatchEvent(new Event('change'));

    assert.deepEqual(changes, ['c']);
  });
});

describe('checkbox', () => {
  it('renders an unchecked checkbox with a connected label', () => {
    const { root, input } = checkbox({ label: 'Show archived' });
    const label = root.querySelector('label');

    assert.equal(root.className, 'ghx-checkbox');
    assert.equal(input.type, 'checkbox');
    assert.equal(input.checked, false);
    assert.equal(label?.getAttribute('for'), input.id);
    assert.equal(label?.textContent, 'Show archived');
    assert.equal(input.hasAttribute('aria-describedby'), false);
    assert.equal(root.querySelector('.ghx-hint'), null);
  });

  it('supports a hint, the checked state and change callbacks', () => {
    const changes: boolean[] = [];
    const { root, input } = checkbox({
      label: 'Drafts',
      hint: 'Include draft pull requests',
      checked: true,
      name: 'drafts',
      disabled: false,
      onChange: (checked) => changes.push(checked),
    });
    const hint = root.querySelector('.ghx-hint');

    assert.equal(input.checked, true);
    assert.equal(input.name, 'drafts');
    assert.equal(input.getAttribute('aria-describedby'), hint?.id);
    assert.equal(hint?.textContent, 'Include draft pull requests');

    input.checked = false;
    input.dispatchEvent(new Event('change'));

    assert.deepEqual(changes, [false]);
  });
});

describe('formField', () => {
  it('connects label and control and assigns an id', () => {
    const control = textInput();
    const field = formField({ label: 'Title', control });
    const label = field.querySelector('label');

    assert.ok(control.id !== '');
    assert.equal(label?.getAttribute('for'), control.id);
    assert.equal(label?.textContent, 'Title');
    assert.equal(control.hasAttribute('aria-describedby'), false);
    assert.equal(control.hasAttribute('aria-invalid'), false);
    assert.equal(field.className, 'ghx-field');
  });

  it('keeps an existing id and describes the control with hint and error', () => {
    const control = select({ options: [{ value: 'a', label: 'A' }], id: 'repo' });
    const field = formField({
      label: 'Repository',
      control,
      hint: h('span', null, 'Pick one'),
      error: 'Required',
      required: true,
    });

    assert.equal(control.id, 'repo');
    assert.equal(control.getAttribute('aria-describedby'), 'repo-hint repo-error');
    assert.equal(control.getAttribute('aria-invalid'), 'true');
    assert.equal(control.required, true);
    assert.ok(field.classList.contains('ghx-field--invalid'));
    assert.equal(field.querySelector('#repo-hint')?.textContent, 'Pick one');
    assert.equal(field.querySelector('#repo-error')?.textContent, 'Required');
    assert.equal(field.querySelector('.ghx-field__required')?.getAttribute('aria-hidden'), 'true');
  });

  it('describes the control with only an error', () => {
    const control = textInput({ id: 'name' });
    formField({ label: 'Name', control, error: 'Too long', hint: null });

    assert.equal(control.getAttribute('aria-describedby'), 'name-error');
  });
});

describe('notice', () => {
  it('renders an info status by default', () => {
    const element = notice({ message: 'Saved locally' });

    assert.equal(element.className, 'ghx-notice ghx-notice--info');
    assert.equal(element.getAttribute('role'), 'status');
    assert.ok(element.querySelector('.ghx-icon--info'));
    assert.equal(element.querySelector('.ghx-notice__title'), null);
    assert.equal(element.querySelector('.ghx-notice__actions'), null);
    assert.equal(element.querySelector('.ghx-notice__message')?.textContent, 'Saved locally');
  });

  it('uses alerts and matching icons for the other variants', () => {
    const expected = [
      ['success', 'status', 'check-circle'],
      ['warning', 'alert', 'alert'],
      ['danger', 'alert', 'stop'],
    ] as const;
    for (const [variant, role, iconName] of expected) {
      const element = notice({ message: 'x', variant });
      assert.equal(element.getAttribute('role'), role, variant);
      assert.ok(element.querySelector(`.ghx-icon--${iconName}`), variant);
    }
  });

  it('renders title and actions', () => {
    const element = notice({
      title: 'Token expires soon',
      message: 'Renew it',
      actions: [button({ label: 'Open settings' })],
    });

    assert.equal(element.querySelector('.ghx-notice__title')?.textContent, 'Token expires soon');
    assert.equal(element.querySelectorAll('.ghx-notice__actions button').length, 1);
  });
});
