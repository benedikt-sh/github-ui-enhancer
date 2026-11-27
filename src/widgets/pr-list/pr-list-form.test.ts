import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { ConfigFormContext } from '../../shared/widget.ts';
import { defaultPullRequestListConfig } from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';
import { renderPullRequestListForm } from './pr-list-form.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('renderPullRequestListForm', () => {
  let target: HTMLElement;
  let submitted: PullRequestListConfig[];
  let cancelled: number;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.replaceChildren(target);
    submitted = [];
    cancelled = 0;
  });

  function render(overrides: Partial<PullRequestListConfig> = {}): () => void {
    const context: ConfigFormContext<PullRequestListConfig> = {
      config: { ...defaultPullRequestListConfig(), ...overrides },
      data: createFakeWidgetData(),
      signal: new AbortController().signal,
      submit: (config) => submitted.push(config),
      cancel: () => {
        cancelled += 1;
      },
    };
    return renderPullRequestListForm(target, context);
  }

  const input = (name: string): HTMLInputElement => {
    const element = target.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    assert.ok(element, `input ${name} not found`);
    return element;
  };
  const limitSelect = (): HTMLSelectElement => {
    const element = target.querySelector<HTMLSelectElement>('select[name="limit"]');
    assert.ok(element);
    return element;
  };
  const buttonByLabel = (label: string): HTMLButtonElement => {
    const button = [...target.querySelectorAll('button')].find(
      (element) => element.textContent === label,
    );
    assert.ok(button, `button "${label}" not found`);
    return button;
  };
  const labelOf = (control: HTMLElement): string | null =>
    target.querySelector(`label[for="${control.id}"]`)?.textContent ?? null;
  const submit = (): void => {
    buttonByLabel('Save').click();
  };
  const typeInto = (element: HTMLInputElement, value: string): void => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('prefills the fields from the config', () => {
    render({ title: 'Team', query: 'is:open org:acme', limit: 50, showRepo: false });

    assert.equal(input('title').value, 'Team');
    assert.equal(labelOf(input('title')), 'Title');
    assert.equal(input('query').value, 'is:open org:acme');
    assert.equal(labelOf(input('query')), 'Search query *');
    assert.equal(input('query').required, true);
    assert.equal(limitSelect().value, '50');
    assert.deepEqual(
      [...limitSelect().options].map((option) => option.value),
      ['5', '10', '20', '50'],
    );
    assert.equal(labelOf(limitSelect()), 'Number of pull requests');
    assert.equal(input('showRepo').checked, false);
    assert.equal(labelOf(input('showRepo')), 'Show repository');
    assert.ok(target.querySelector('form')?.hasAttribute('novalidate'));
  });

  it('explains that is:pr is added automatically', () => {
    render();

    const hint = document.getElementById(`${input('query').id}-hint`);
    assert.match(hint?.textContent ?? '', /^is:pr is added automatically\. Examples: /);
    assert.equal(hint?.querySelectorAll('code').length, 3);
  });

  it('derives the title placeholder from the query', () => {
    render();
    assert.equal(input('title').value, '');
    assert.equal(input('title').placeholder, 'Review requested');

    typeInto(input('query'), 'is:open org:acme');
    assert.equal(input('title').placeholder, 'is:open org:acme');
  });

  it('fills the query from preset quick-picks', () => {
    render({ query: 'is:open org:acme' });

    const group = target.querySelector('[role="group"]');
    assert.equal(group?.getAttribute('aria-label'), 'Query presets');
    assert.deepEqual(
      [...(group?.querySelectorAll('button') ?? [])].map((button) => button.textContent),
      ['Assigned to me', 'Review requested', 'Created by me'],
    );

    buttonByLabel('Created by me').click();
    assert.equal(input('query').value, 'is:open archived:false author:@me');
    assert.equal(input('title').placeholder, 'Created by me');
    assert.equal(document.activeElement, input('query'));
    assert.equal(submitted.length, 0);
  });

  it('submits the normalized config', () => {
    render();
    input('title').value = '  My reviews ';
    input('query').value = '  is:open   org:acme ';
    limitSelect().value = '20';
    input('showRepo').click();
    submit();

    assert.deepEqual(submitted, [
      { title: 'My reviews', query: 'is:open org:acme', limit: 20, showRepo: false },
    ]);
  });

  it('submits a blank title as null', () => {
    render({ title: 'Old' });
    input('title').value = '   ';
    submit();

    assert.equal(submitted[0]?.title, null);
  });

  it('rejects an empty query', () => {
    render();
    input('query').value = '   ';
    submit();
    submit();

    assert.equal(submitted.length, 0);
    const query = input('query');
    assert.equal(query.getAttribute('aria-invalid'), 'true');
    const errors = target.querySelectorAll('.ghx-field__error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.textContent, 'Enter a search query.');
    assert.equal(document.activeElement, query);
    assert.equal(target.querySelectorAll('input[name="query"]').length, 1);

    query.value = 'is:open';
    submit();
    assert.equal(submitted[0]?.query, 'is:open');
  });

  it('cancels without submitting', () => {
    render();
    buttonByLabel('Cancel').click();

    assert.equal(cancelled, 1);
    assert.equal(submitted.length, 0);
  });

  it('removes the form on dispose', () => {
    const dispose = render();
    dispose();

    assert.equal(target.childElementCount, 0);
  });
});
