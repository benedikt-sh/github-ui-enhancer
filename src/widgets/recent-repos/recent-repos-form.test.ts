import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { ConfigFormContext } from '../../shared/widget.ts';
import { defaultRecentReposConfig } from './recent-repos-config.ts';
import type { RecentReposConfig } from './recent-repos-config.ts';
import { renderRecentReposForm } from './recent-repos-form.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('renderRecentReposForm', () => {
  let target: HTMLElement;
  let submitted: RecentReposConfig[];
  let cancelled: number;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.replaceChildren(target);
    submitted = [];
    cancelled = 0;
  });

  function render(overrides: Partial<RecentReposConfig> = {}): () => void {
    const context: ConfigFormContext<RecentReposConfig> = {
      config: { ...defaultRecentReposConfig(), ...overrides },
      data: createFakeWidgetData(),
      signal: new AbortController().signal,
      submit: (config) => submitted.push(config),
      cancel: () => {
        cancelled += 1;
      },
    };
    return renderRecentReposForm(target, context);
  }

  const titleInput = (): HTMLInputElement => {
    const element = target.querySelector<HTMLInputElement>('input[name="title"]');
    assert.ok(element);
    return element;
  };
  const selectByName = (name: string): HTMLSelectElement => {
    const element = target.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
    assert.ok(element, `select ${name} not found`);
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
  const choose = (element: HTMLSelectElement, value: string): void => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('prefills the fields from the config', () => {
    render({ title: 'Work', activity: 'all', limit: 20 });

    assert.equal(titleInput().value, 'Work');
    assert.equal(labelOf(titleInput()), 'Title');
    assert.equal(selectByName('activity').value, 'all');
    assert.equal(labelOf(selectByName('activity')), 'Activity');
    assert.deepEqual(
      [...selectByName('activity').options].map((option) => [option.value, option.textContent]),
      [
        ['code', 'Code changes'],
        ['all', 'All activity'],
      ],
    );
    assert.equal(selectByName('limit').value, '20');
    assert.deepEqual(
      [...selectByName('limit').options].map((option) => option.value),
      ['2', '3', '5', '10', '20'],
    );
    assert.equal(labelOf(selectByName('limit')), 'Number of repositories');
    assert.ok(target.querySelector('form')?.hasAttribute('novalidate'));
  });

  it('explains which events each activity counts', () => {
    render();

    const hint = document.getElementById(`${selectByName('activity').id}-hint`);
    assert.match(hint?.textContent ?? '', /^Code changes are pushes, pull requests/);
  });

  it('derives the title placeholder from the activity', () => {
    render();
    assert.equal(titleInput().value, '');
    assert.equal(titleInput().placeholder, 'Recently changed');

    choose(selectByName('activity'), 'all');
    assert.equal(titleInput().placeholder, 'All recent activity');
    choose(selectByName('activity'), 'code');
    assert.equal(titleInput().placeholder, 'Recently changed');
  });

  it('submits the normalized config', () => {
    render();
    titleInput().value = '  My repos ';
    selectByName('activity').value = 'all';
    selectByName('limit').value = '5';
    buttonByLabel('Save').click();

    assert.deepEqual(submitted, [{ title: 'My repos', activity: 'all', limit: 5 }]);
  });

  it('submits a blank title as null', () => {
    render({ title: 'Old' });
    titleInput().value = '   ';
    buttonByLabel('Save').click();

    assert.deepEqual(submitted, [{ title: null, activity: 'code', limit: 10 }]);
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
