import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { ConfigFormContext } from '../../shared/widget.ts';
import { defaultDependabotPrsConfig } from './dependabot-prs-config.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';
import { renderDependabotPrsForm } from './dependabot-prs-form.ts';
import { buttonByText, flush, NOW, repo, repoSummary, typeInto } from './dependabot-prs.fixture.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('renderDependabotPrsForm', () => {
  let data: FakeWidgetData;
  let target: HTMLElement;
  let submitted: DependabotPrsConfig[];
  let cancelled: number;

  beforeEach(() => {
    data = createFakeWidgetData();
    data.handle('repoIndex', async () =>
      dataResult([repoSummary('octo/api'), repoSummary('acme/web')]),
    );
    target = document.createElement('div');
    document.body.replaceChildren(target);
    submitted = [];
    cancelled = 0;
  });

  function render(overrides: Partial<DependabotPrsConfig> = {}) {
    const context: ConfigFormContext<DependabotPrsConfig> = {
      config: { ...defaultDependabotPrsConfig(), ...overrides },
      data,
      signal: new AbortController().signal,
      submit: (config) => submitted.push(config),
      cancel: () => {
        cancelled += 1;
      },
    };
    return renderDependabotPrsForm(target, context, { now: () => NOW.getTime() });
  }

  const form = (): HTMLFormElement => {
    const element = target.querySelector('form');
    assert.ok(element);
    return element;
  };
  const input = (name: string): HTMLInputElement => {
    const element = target.querySelector<HTMLInputElement>(`[name="${name}"]`);
    assert.ok(element, `input ${name} not found`);
    return element;
  };
  const submit = (): void => {
    form().dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
  };
  const option = (name: string): HTMLButtonElement => {
    const found = [
      ...target.querySelectorAll<HTMLButtonElement>('.ghx-dependabot-picker__option'),
    ].find((element) => element.textContent === name);
    assert.ok(found, `option ${name} not found`);
    return found;
  };

  it('fills the fields from the config and submits it', async () => {
    render({ repos: [repo('octo/api')], title: 'Deps', limit: 20, groupByRepo: true });
    await flush();

    assert.equal(input('title').value, 'Deps');
    assert.equal(input('title').placeholder, 'Dependabot: octo/api');
    assert.equal(target.querySelector<HTMLSelectElement>('[name="limit"]')?.value, '20');
    assert.equal(input('groupByRepo').checked, true);
    assert.deepEqual(
      [...target.querySelectorAll('.ghx-dependabot-picker__chip-name')].map((e) => e.textContent),
      ['octo/api'],
    );

    submit();
    assert.deepEqual(submitted, [
      { repos: [repo('octo/api')], title: 'Deps', limit: 20, groupByRepo: true },
    ]);
  });

  it('submits changed fields', async () => {
    render({ repos: [repo('octo/api')] });
    await flush();

    option('acme/web').click();
    assert.equal(input('title').placeholder, 'Dependabot: 2 repositories');
    input('title').value = '   ';
    const limit = target.querySelector<HTMLSelectElement>('[name="limit"]');
    assert.ok(limit);
    limit.value = '50';
    input('groupByRepo').checked = true;
    submit();

    assert.deepEqual(submitted, [
      {
        repos: [repo('octo/api'), repo('acme/web')],
        title: null,
        limit: 50,
        groupByRepo: true,
      },
    ]);
  });

  it('requires at least one repository', async () => {
    render();
    await flush();
    const repoInput = target.querySelector<HTMLInputElement>('.ghx-dependabot-picker input');
    assert.ok(repoInput);
    const error = target.querySelector<HTMLElement>('.ghx-field__error');
    assert.equal(error?.hidden, true);
    assert.equal(input('title').placeholder, 'Dependabot pull requests');

    submit();
    assert.deepEqual(submitted, []);
    assert.equal(error?.hidden, false);
    assert.equal(error?.textContent, 'Choose at least one repository.');
    assert.equal(repoInput.getAttribute('aria-invalid'), 'true');
    assert.equal(repoInput.getAttribute('aria-describedby'), error?.id);
    assert.equal(document.activeElement, repoInput);
    assert.ok(target.querySelector('.ghx-field--invalid'));

    typeInto(repoInput, 'api');
    option('octo/api').click();
    assert.equal(error?.hidden, true);
    assert.equal(repoInput.hasAttribute('aria-invalid'), false);
    assert.equal(target.querySelector('.ghx-field--invalid'), null);

    buttonByText(target, 'Remove octo/api').click();
    assert.equal(error?.hidden, true);
    submit();
    assert.equal(error?.hidden, false);
  });

  it('labels the repo filter and cancels', async () => {
    render();
    const label = [...target.querySelectorAll('label')].find((element) =>
      element.textContent?.startsWith('Repositories'),
    );
    const repoInput = target.querySelector<HTMLInputElement>('.ghx-dependabot-picker input');
    assert.equal(label?.getAttribute('for'), repoInput?.id);

    buttonByText(target, 'Cancel').click();
    assert.equal(cancelled, 1);
  });

  it('removes the form on dispose', () => {
    const dispose = render();
    dispose();
    assert.equal(target.querySelector('form'), null);
  });
});
