import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RepoSummary } from '../../shared/types.ts';
import { NOW, repoSummary, settle } from './actions-runs.fixture.ts';
import { repoPicker } from './repo-picker.ts';
import type { RepoPickerOptions } from './repo-picker.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPOS = [
  repoSummary('octo/api', { description: 'The API' }),
  repoSummary('octo/web'),
  repoSummary('acme/tools'),
];

function setup(overrides: Partial<RepoPickerOptions> = {}, repos: RepoSummary[] = REPOS) {
  const data: FakeWidgetData = createFakeWidgetData();
  data.handle('repoIndex', async () => dataResult(repos));
  const selections: RepoSummary[] = [];
  let settingsOpened = 0;
  const controller = new AbortController();
  const options: RepoPickerOptions = {
    data,
    signal: controller.signal,
    now: () => NOW,
    selected: null,
    onSelect: (repo) => selections.push(repo),
    onOpenSettings: () => {
      settingsOpened += 1;
    },
    ...overrides,
  };
  return {
    data,
    selections,
    controller,
    options,
    settingsOpened: () => settingsOpened,
  };
}

function names(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.ghx-actions-runs-picker__name')].map(
    (element) => element.textContent ?? '',
  );
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function key(target: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  assert.ok(found, `button "${text}" not found`);
  return found;
}

describe('repoPicker', () => {
  it('shows a loading state, then all repos and filters them', async () => {
    const { options, data } = setup({ inputId: 'picker' });
    const picker = repoPicker(options);
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
    assert.equal(picker.input.disabled, true);
    assert.equal(picker.input.id, 'picker');
    await settle();
    assert.equal(picker.input.disabled, false);
    assert.equal(names(picker.root).length, 3);
    assert.ok(picker.root.textContent?.includes('The API'));
    assert.deepEqual(data.callsTo('repoIndex'), [[{ forceRefresh: false }]]);

    type(picker.input, 'web');
    assert.deepEqual(names(picker.root), ['octo/web']);

    type(picker.input, 'zzzzz');
    assert.deepEqual(names(picker.root), []);
    assert.ok(picker.root.textContent?.includes('No matching repositories.'));
  });

  it('respects the limit', async () => {
    const { options } = setup({ limit: 1 });
    const picker = repoPicker(options);
    await settle();
    assert.equal(names(picker.root).length, 1);
  });

  it('selects by click and by Enter on the first match', async () => {
    const { options, selections } = setup();
    const picker = repoPicker(options);
    await settle();
    type(picker.input, 'tools');
    buttonByText(picker.root, 'acme/tools').click();
    assert.equal(selections[0]?.fullName, 'acme/tools');

    const event = key(picker.input, 'Enter');
    assert.equal(event.defaultPrevented, true);
    assert.equal(selections[1]?.fullName, 'acme/tools');

    type(picker.input, 'zzzzz');
    key(picker.input, 'Enter');
    assert.equal(selections.length, 2);
    key(picker.input, 'a');
  });

  it('marks the selected repo, case-insensitively', async () => {
    const { options } = setup({ selected: { owner: 'Octo', name: 'API' } });
    const picker = repoPicker(options);
    await settle();
    const pressed = () =>
      [...picker.root.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent);
    assert.deepEqual(pressed(), ['octo/apiThe API']);
    picker.setSelected({ owner: 'octo', name: 'web' });
    assert.deepEqual(pressed(), ['octo/web']);
    picker.setSelected(null);
    assert.deepEqual(pressed(), []);
  });

  it('moves focus with the arrow keys', async () => {
    const { options } = setup();
    const picker = repoPicker(options);
    document.body.append(picker.root);
    await settle();
    const buttons = [...picker.root.querySelectorAll('button')];
    key(picker.input, 'ArrowDown');
    assert.equal(document.activeElement, buttons[0]);
    key(buttons[0]!, 'ArrowDown');
    assert.equal(document.activeElement, buttons[1]);
    key(buttons[2]!, 'ArrowDown');
    assert.equal(document.activeElement, buttons[2]);
    key(buttons[1]!, 'ArrowUp');
    assert.equal(document.activeElement, buttons[0]);
    key(buttons[0]!, 'ArrowUp');
    assert.equal(document.activeElement, picker.input);
    key(buttons[0]!, 'Home');
    assert.equal(document.activeElement, picker.input);
    picker.root.remove();
  });

  it('ignores input before the index is loaded', () => {
    const { options } = setup();
    const picker = repoPicker(options);
    type(picker.input, 'x');
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
  });

  it('offers the settings when there are no repositories', async () => {
    const setupResult = setup({}, []);
    const picker = repoPicker(setupResult.options);
    await settle();
    assert.ok(picker.root.textContent?.includes('No repositories'));
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(setupResult.settingsOpened(), 1);
  });

  it('shows errors without data and retries bypassing the cache', async () => {
    const { options, data, settingsOpened } = setup();
    data.handle('repoIndex', async () =>
      dataResult([], { errors: [{ kind: 'no_tokens', message: '' }] }),
    );
    const picker = repoPicker(options);
    await settle();
    assert.ok(picker.root.textContent?.includes('Could not load repositories'));
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(settingsOpened(), 1);
    data.handle('repoIndex', async () => dataResult(REPOS));
    buttonByText(picker.root, 'Retry').click();
    await settle();
    assert.equal(names(picker.root).length, 3);
    assert.deepEqual(data.callsTo('repoIndex')[1], [{ forceRefresh: true }]);
  });

  it('shows partial errors above the list', async () => {
    const { options, data, settingsOpened } = setup();
    data.handle('repoIndex', async () =>
      dataResult(REPOS, {
        errors: [
          { kind: 'unauthorized', message: '', owner: 'acme' },
          { kind: 'network', message: '' },
        ],
      }),
    );
    const picker = repoPicker(options);
    await settle();
    const warning = picker.root.querySelector('.ghx-notice--warning');
    assert.ok(warning?.textContent?.includes('The token for acme is invalid'));
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(settingsOpened(), 1);
    assert.equal(names(picker.root).length, 3);
  });

  it('shows partial errors without settings for other kinds', async () => {
    const { options, data } = setup();
    data.handle('repoIndex', async () =>
      dataResult(REPOS, { errors: [{ kind: 'network', message: '' }] }),
    );
    const picker = repoPicker(options);
    await settle();
    assert.ok(picker.root.querySelector('.ghx-notice--warning'));
    assert.equal(
      [...picker.root.querySelectorAll('button')].some((b) => b.textContent === 'Open settings'),
      false,
    );
  });

  it('shows rejected requests as error with retry', async () => {
    const { options, data } = setup();
    data.handle('repoIndex', async () => {
      throw new ApiError({ kind: 'network', message: 'down' });
    });
    const picker = repoPicker(options);
    await settle();
    assert.ok(picker.root.querySelector('.ghx-state--error'));
    assert.ok(picker.root.textContent?.includes('GitHub could not be reached'));
    buttonByText(picker.root, 'Retry').click();
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
  });

  it('ignores responses after abort', async () => {
    const resolved = setup();
    const picker = repoPicker(resolved.options);
    resolved.controller.abort();
    await settle();
    assert.ok(picker.root.querySelector('.ghx-state--loading'));

    const rejected = setup();
    rejected.data.handle('repoIndex', async () => {
      throw new Error('late');
    });
    const other = repoPicker(rejected.options);
    rejected.controller.abort();
    await settle();
    assert.ok(other.root.querySelector('.ghx-state--loading'));
  });
});
