import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { ASSIGNED_QUERY, CREATED_QUERY, defaultIssueListConfig } from './config.ts';
import type { IssueListConfig } from './config.ts';
import { renderIssueListForm } from './issue-list-form.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

interface FormHarness {
  readonly target: HTMLElement;
  readonly submitted: IssueListConfig[];
  readonly cancelled: number[];
  readonly dispose: Dispose;
}

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  target.remove();
});

function render(config: Partial<IssueListConfig> = {}): FormHarness {
  const submitted: IssueListConfig[] = [];
  const cancelled: number[] = [];
  const context: ConfigFormContext<IssueListConfig> = {
    config: { ...defaultIssueListConfig(), ...config },
    data: createFakeWidgetData(),
    signal: new AbortController().signal,
    submit: (value) => submitted.push(value),
    cancel: () => cancelled.push(1),
  };
  const dispose = renderIssueListForm(target, context);
  return { target, submitted, cancelled, dispose };
}

function field(label: string): HTMLInputElement & HTMLSelectElement {
  const labelElement = [...target.querySelectorAll('label')].find(
    (element) => element.textContent?.replace(' *', '') === label,
  );
  assert.ok(labelElement, `label "${label}" exists`);
  const control = target.querySelector(`[id="${labelElement.getAttribute('for')}"]`);
  assert.ok(control, `control for "${label}" exists`);
  return control as HTMLInputElement & HTMLSelectElement;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  assert.ok(found, `button "${label}" exists`);
  return found;
}

function setValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  control.value = value;
  const type = control instanceof HTMLSelectElement ? 'change' : 'input';
  control.dispatchEvent(new Event(type, { bubbles: true }));
}

function submit(): void {
  const form = target.querySelector('form');
  assert.ok(form);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function querySlot(): HTMLElement {
  const slot = target.querySelector<HTMLElement>('.ghx-issue-list-form__query');
  assert.ok(slot);
  return slot;
}

describe('renderIssueListForm', () => {
  it('fills the controls from the config', () => {
    render({ title: 'Mine', query: 'label:bug', limit: 20, showRepo: false });

    assert.equal(field('Source').value, 'search');
    assert.equal(field('Title').value, 'Mine');
    assert.equal(field('Title').placeholder, 'label:bug');
    assert.equal(field('Query').value, 'label:bug');
    assert.equal(field('Number of issues').value, '20');
    assert.equal(field('Show repository').checked, false);
    assert.equal(querySlot().hidden, false);
    assert.match(querySlot().textContent ?? '', /"is:issue" is added automatically/);
  });

  it('offers all limits', () => {
    render();

    const options = [...field('Number of issues').querySelectorAll('option')];
    assert.deepEqual(
      options.map((option) => option.value),
      ['5', '10', '20', '50'],
    );
  });

  it('hides the query for the subscribed source', () => {
    render({ source: 'subscribed', query: '' });

    assert.equal(field('Source').value, 'subscribed');
    assert.equal(field('Query').value, '');
    assert.equal(querySlot().hidden, true);
    assert.equal(field('Title').placeholder, 'Watched issues');
  });

  it('submits the edited config', () => {
    const form = render();
    setValue(field('Title'), '  Bugs ');
    setValue(field('Query'), ' label:bug   is:open ');
    setValue(field('Number of issues'), '50');
    field('Show repository').click();
    submit();

    assert.deepEqual(form.submitted, [
      { source: 'search', title: 'Bugs', query: 'label:bug is:open', limit: 50, showRepo: false },
    ]);
  });

  it('submits a subscribed config without query and validation', () => {
    const form = render();
    setValue(field('Query'), '');
    setValue(field('Source'), 'subscribed');
    submit();

    assert.deepEqual(form.submitted, [
      { source: 'subscribed', title: null, query: '', limit: 10, showRepo: true },
    ]);
  });

  it('updates the title placeholder while typing', () => {
    render();
    assert.equal(field('Title').placeholder, 'Assigned to me');

    setValue(field('Query'), 'label:bug');
    assert.equal(field('Title').placeholder, 'label:bug');

    setValue(field('Query'), '   ');
    assert.equal(field('Title').placeholder, '');
  });

  it('requires a query for searches', () => {
    const form = render();
    setValue(field('Query'), '  ');
    submit();

    assert.deepEqual(form.submitted, []);
    const query = field('Query');
    assert.equal(query.getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, query);
    assert.equal(
      querySlot().querySelector('.ghx-field__error')?.textContent,
      'Enter a search query.',
    );

    setValue(query, 'label:bug');
    assert.equal(query.hasAttribute('aria-invalid'), false);
    assert.equal(querySlot().querySelector('.ghx-field__error'), null);
    submit();
    assert.equal(form.submitted.length, 1);
  });

  it('applies presets as quick picks', () => {
    const form = render({ title: 'Kept', query: 'label:bug' });

    buttonByLabel('Created by me').click();
    assert.equal(field('Query').value, CREATED_QUERY);
    assert.equal(field('Title').placeholder, 'Created by me');

    buttonByLabel('Watched issues').click();
    assert.equal(field('Source').value, 'subscribed');
    assert.equal(querySlot().hidden, true);
    assert.equal(field('Query').value, CREATED_QUERY);

    buttonByLabel('Assigned to me').click();
    assert.equal(field('Source').value, 'search');
    assert.equal(querySlot().hidden, false);
    submit();

    assert.deepEqual(form.submitted, [
      { source: 'search', title: 'Kept', query: ASSIGNED_QUERY, limit: 10, showRepo: true },
    ]);
  });

  it('clears a validation error when a preset is picked', () => {
    render();
    setValue(field('Query'), '');
    submit();
    assert.ok(querySlot().querySelector('.ghx-field__error'));

    buttonByLabel('Created by me').click();
    assert.equal(querySlot().querySelector('.ghx-field__error'), null);
  });

  it('cancels', () => {
    const form = render();
    buttonByLabel('Cancel').click();

    assert.deepEqual(form.cancelled, [1]);
    assert.deepEqual(form.submitted, []);
  });

  it('removes the form on dispose', () => {
    const form = render();
    form.dispose();

    assert.equal(target.childElementCount, 0);
  });
});
