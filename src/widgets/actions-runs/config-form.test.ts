import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { ConfigFormContext } from '../../shared/widget.ts';
import { NOW, repoSummary, settle } from './actions-runs.fixture.ts';
import { renderActionsRunsConfig } from './config-form.ts';
import type { ActionsRunsConfig } from './config.ts';
import { defaultActionsRunsConfig } from './config.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPO = { owner: 'octo', name: 'api' };

function setup(config: ActionsRunsConfig = defaultActionsRunsConfig()) {
  const data = createFakeWidgetData();
  data.handle('repoIndex', async () =>
    dataResult([repoSummary('octo/api'), repoSummary('octo/web')]),
  );
  data.handle('branches', async (repo) =>
    dataResult([
      { name: 'main', protected: true },
      { name: `${repo.name}-dev`, protected: false },
    ]),
  );
  const submitted: ActionsRunsConfig[] = [];
  let cancelled = 0;
  const controller = new AbortController();
  const context: ConfigFormContext<ActionsRunsConfig> = {
    config,
    data,
    signal: controller.signal,
    submit: (value) => submitted.push(value),
    cancel: () => {
      cancelled += 1;
    },
  };
  const target = document.createElement('div');
  document.body.append(target);
  const dispose = renderActionsRunsConfig(target, context, { now: () => NOW });
  return { data, target, dispose, submitted, cancelled: () => cancelled };
}

function form(target: HTMLElement): HTMLFormElement {
  const element = target.querySelector('form');
  assert.ok(element);
  return element;
}

function submit(target: HTMLElement): void {
  form(target).dispatchEvent(new Event('submit', { cancelable: true }));
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  assert.ok(found, `button "${text}" not found`);
  return found;
}

function selectByName(target: HTMLElement, name: string): HTMLSelectElement {
  const element = target.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  assert.ok(element);
  return element;
}

function branchControl(target: HTMLElement): HTMLSelectElement {
  const element = target.querySelector<HTMLSelectElement>('.ghx-actions-runs-form__branch select');
  assert.ok(element);
  return element;
}

describe('renderActionsRunsConfig', () => {
  it('requires a repository before saving', async () => {
    const { target, submitted } = setup();
    await settle();
    const branch = branchControl(target);
    assert.equal(branch.disabled, true);
    assert.ok(target.textContent?.includes('No repository selected.'));
    submit(target);
    assert.deepEqual(submitted, []);
    const error = target.querySelector<HTMLElement>('.ghx-field__error');
    assert.equal(error?.hidden, false);
    const input = target.querySelector('input[type="search"]');
    assert.equal(input?.getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, input);

    buttonByText(target, 'octo/web').click();
    assert.equal(error?.hidden, true);
    assert.equal(input?.hasAttribute('aria-invalid'), false);
    assert.ok(target.textContent?.includes('Selected: octo/web'));
  });

  it('submits the chosen repo, branch, limit and title', async () => {
    const { target, submitted, data } = setup();
    await settle();
    buttonByText(target, 'octo/api').click();
    await settle();
    assert.deepEqual(data.callsTo('branches'), [[REPO]]);
    const branch = branchControl(target);
    assert.equal(branch.disabled, false);
    branch.value = 'api-dev';
    branch.dispatchEvent(new Event('change'));
    const title = target.querySelector<HTMLInputElement>('input[name="title"]');
    assert.ok(title);
    assert.equal(title.placeholder, 'Actions: octo/api @ api-dev');
    title.value = '  Deploys  ';
    selectByName(target, 'limit').value = '20';
    const status = selectByName(target, 'status');
    assert.equal(status.value, 'all');
    status.value = 'failure';
    status.dispatchEvent(new Event('change'));
    assert.equal(title.placeholder, 'Actions: octo/api @ api-dev (failed)');
    submit(target);
    assert.deepEqual(submitted, [
      { repo: REPO, branch: 'api-dev', limit: 20, status: 'failure', title: 'Deploys' },
    ]);
  });

  it('starts from the existing config and resets the branch on a repo change', async () => {
    const config = {
      repo: REPO,
      branch: 'main',
      limit: 5,
      status: 'failure',
      title: null,
    } as const;
    const { target, submitted } = setup(config);
    await settle();
    assert.ok(target.textContent?.includes('Selected: octo/api'));
    assert.equal(branchControl(target).value, 'main');
    assert.equal(selectByName(target, 'limit').value, '5');
    assert.equal(selectByName(target, 'status').value, 'failure');

    buttonByText(target, 'octo/api').click();
    assert.equal(branchControl(target).value, 'main');

    buttonByText(target, 'octo/web').click();
    assert.equal(branchControl(target).value, '');
    submit(target);
    assert.deepEqual(submitted, [
      {
        repo: { owner: 'octo', name: 'web' },
        branch: null,
        limit: 5,
        status: 'failure',
        title: null,
      },
    ]);
  });

  it('falls back to the default limit for unknown values', async () => {
    const { target, submitted } = setup({ ...defaultActionsRunsConfig(), repo: REPO });
    await settle();
    selectByName(target, 'limit').value = '7';
    submit(target);
    assert.equal(submitted[0]?.limit, 10);
  });

  it('falls back to all runs for unknown status values', async () => {
    const config = { ...defaultActionsRunsConfig(), repo: REPO, status: 'failure' } as const;
    const { target, submitted } = setup(config);
    await settle();
    const status = selectByName(target, 'status');
    status.value = 'success';
    status.dispatchEvent(new Event('change'));
    submit(target);
    assert.equal(submitted[0]?.status, 'all');
  });

  it('cancels and disposes', () => {
    const { target, cancelled, dispose } = setup();
    buttonByText(target, 'Cancel').click();
    assert.equal(cancelled(), 1);
    dispose();
    assert.equal(target.childElementCount, 0);
  });
});
