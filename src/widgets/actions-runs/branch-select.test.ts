import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { ApiError } from '../../shared/errors.ts';
import { branchSelect } from './branch-select.ts';
import type { BranchSelectOptions } from './branch-select.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPO = { owner: 'octo', name: 'repo' };

function branches(...names: string[]): { name: string; protected: boolean }[] {
  return names.map((name) => ({ name, protected: false }));
}

function optionValues(element: HTMLSelectElement): string[] {
  return [...element.options].map((option) => option.value);
}

function setup(overrides: Partial<BranchSelectOptions> = {}) {
  const data = createFakeWidgetData();
  const changes: (string | null)[] = [];
  const controller = new AbortController();
  const options: BranchSelectOptions = {
    data,
    repo: REPO,
    value: null,
    signal: controller.signal,
    lazy: false,
    onChange: (branch) => changes.push(branch),
    ...overrides,
  };
  return { data, changes, controller, options };
}

describe('branchSelect', () => {
  it('loads branches right away and keeps the selection', async () => {
    const { data, options } = setup({ value: 'dev', ariaLabel: 'Branch', className: 'x' });
    data.handle('branches', async () => dataResult(branches('main', 'dev')));
    const control = branchSelect({ ...options, data });
    assert.deepEqual(optionValues(control.element), ['', 'dev']);
    assert.equal(control.element.getAttribute('aria-label'), 'Branch');
    assert.ok(control.element.classList.contains('x'));
    await control.load();
    assert.deepEqual(optionValues(control.element), ['', 'main', 'dev']);
    assert.equal(control.element.value, 'dev');
    assert.equal(control.element.options[0]?.textContent, 'All branches');
    assert.equal(data.callsTo('branches').length, 1);
  });

  it('keeps a selected branch that is missing from the list', async () => {
    const { data, options } = setup({ value: 'gone' });
    data.handle('branches', async () => dataResult(branches('main')));
    const control = branchSelect(options);
    await control.load();
    assert.deepEqual(optionValues(control.element), ['', 'gone', 'main']);
    assert.equal(control.element.value, 'gone');
  });

  it('reports changes, mapping "All branches" to null', () => {
    const { changes, options } = setup();
    const control = branchSelect({ ...options, value: 'main' });
    control.element.value = '';
    control.element.dispatchEvent(new Event('change'));
    assert.deepEqual(changes, [null]);
  });

  it('loads lazily on hover or focus, only once', async () => {
    const { data, options } = setup({ lazy: true });
    data.handle('branches', async () => dataResult(branches('main')));
    const control = branchSelect(options);
    assert.equal(data.callsTo('branches').length, 0);
    control.element.dispatchEvent(new Event('pointerenter'));
    control.element.dispatchEvent(new Event('focus'));
    await control.load();
    assert.equal(data.callsTo('branches').length, 1);
    assert.deepEqual(optionValues(control.element), ['', 'main']);
  });

  it('flags errors but still shows partial data', async () => {
    const { data, options } = setup();
    data.handle('branches', async () =>
      dataResult(branches('main'), { errors: [{ kind: 'network', message: 'x' }] }),
    );
    const control = branchSelect(options);
    await control.load();
    assert.equal(control.element.title, 'Could not load the branches');
    assert.deepEqual(optionValues(control.element), ['', 'main']);
  });

  it('flags rejected requests', async () => {
    const { data, options } = setup();
    data.handle('branches', async () => {
      throw new ApiError({ kind: 'network', message: 'down' });
    });
    const control = branchSelect(options);
    await control.load();
    assert.equal(control.element.title, 'Could not load the branches');
  });

  it('ignores responses after abort', async () => {
    const { data, controller, options } = setup();
    data.handle('branches', async () => dataResult(branches('main')));
    const control = branchSelect(options);
    controller.abort();
    await control.load();
    assert.deepEqual(optionValues(control.element), ['']);

    const rejected = setup();
    rejected.data.handle('branches', async () => {
      throw new Error('late');
    });
    const other = branchSelect(rejected.options);
    rejected.controller.abort();
    await other.load();
    assert.equal(other.element.title, '');
  });
});
