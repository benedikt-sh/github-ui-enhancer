import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { DataResult } from '../../shared/data.ts';
import type { RepoRef, RepoSummary } from '../../shared/types.ts';
import {
  buttonByText,
  deferred,
  flush,
  NOW,
  pressKey,
  repo,
  repoSummary,
  typeInto,
} from './dependabot-prs.fixture.ts';
import { repoMultiPicker } from './repo-multi-picker.ts';
import type { RepoMultiPickerOptions } from './repo-multi-picker.ts';

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

function setup(
  overrides: Partial<RepoMultiPickerOptions> = {},
  index: () => Promise<DataResult<RepoSummary[]>> = async () => dataResult(REPOS),
) {
  const data: FakeWidgetData = createFakeWidgetData();
  data.handle('repoIndex', index);
  const changes: (readonly RepoRef[])[] = [];
  let settingsOpened = 0;
  const controller = new AbortController();
  const picker = repoMultiPicker({
    data,
    signal: controller.signal,
    now: () => NOW.getTime(),
    selected: [],
    onChange: (repos) => changes.push(repos),
    onOpenSettings: () => {
      settingsOpened += 1;
    },
    ...overrides,
  });
  document.body.replaceChildren(picker.root);
  return { data, picker, changes, controller, settingsOpened: () => settingsOpened };
}

function names(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.ghx-dependabot-picker__name')].map(
    (element) => element.textContent ?? '',
  );
}

function chips(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.ghx-dependabot-picker__chip-name')].map(
    (element) => element.textContent ?? '',
  );
}

function option(root: HTMLElement, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('.ghx-dependabot-picker__option')]
    .find((element) => element.querySelector('.ghx-dependabot-picker__name')?.textContent === name);
  assert.ok(found, `option ${name} not found`);
  return found;
}

describe('repoMultiPicker', () => {
  it('shows a loading state, then the repositories, and filters them', async () => {
    const { picker, data } = setup({ inputId: 'repos-input' });

    assert.equal(picker.input.id, 'repos-input');
    assert.equal(picker.input.disabled, true);
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
    assert.equal(picker.root.querySelector('.ghx-hint')?.textContent, 'No repositories selected.');
    assert.deepEqual(data.callsTo('repoIndex'), [[{ forceRefresh: false }]]);

    await flush();
    assert.equal(picker.input.disabled, false);
    assert.deepEqual(names(picker.root).sort(), ['acme/tools', 'octo/api', 'octo/web']);
    assert.equal(
      picker.root.querySelector('.ghx-dependabot-picker__description')?.textContent,
      'The API',
    );

    typeInto(picker.input, 'tools');
    assert.deepEqual(names(picker.root), ['acme/tools']);

    typeInto(picker.input, 'zzzz');
    assert.equal(
      picker.root.querySelector('.ghx-dependabot-picker__results')?.textContent,
      'No matching repositories.',
    );
  });

  it('ignores input before the index arrived', () => {
    const { picker } = setup({}, () => new Promise(() => {}));
    typeInto(picker.input, 'api');
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
  });

  it('adds and removes repositories by clicking options', async () => {
    const { picker, changes } = setup();
    await flush();

    option(picker.root, 'octo/api').click();
    assert.deepEqual(changes, [[repo('octo/api')]]);
    assert.deepEqual(chips(picker.root), ['octo/api']);
    assert.equal(option(picker.root, 'octo/api').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(picker.selected(), [repo('octo/api')]);

    option(picker.root, 'acme/tools').click();
    assert.deepEqual(chips(picker.root), ['octo/api', 'acme/tools']);

    option(picker.root, 'octo/api').click();
    assert.deepEqual(chips(picker.root), ['acme/tools']);
    assert.equal(option(picker.root, 'octo/api').getAttribute('aria-pressed'), 'false');
    assert.equal(changes.length, 3);
  });

  it('keeps the clicked option focused after re-rendering', async () => {
    const { picker } = setup();
    await flush();

    option(picker.root, 'octo/web').focus();
    option(picker.root, 'octo/web').click();
    assert.equal(
      document.activeElement?.querySelector('.ghx-dependabot-picker__name')?.textContent,
      'octo/web',
    );
  });

  it('shows preselected repositories that are not in the index and removes them', async () => {
    const { picker, changes } = setup({ selected: [repo('Gone/Repo'), repo('octo/api')] });
    await flush();

    assert.deepEqual(chips(picker.root), ['Gone/Repo', 'octo/api']);
    assert.equal(option(picker.root, 'octo/api').getAttribute('aria-pressed'), 'true');

    buttonByText(picker.root, 'Remove Gone/Repo').click();
    assert.deepEqual(changes, [[repo('octo/api')]]);
    assert.deepEqual(chips(picker.root), ['octo/api']);
    assert.equal(document.activeElement, picker.input);
  });

  it('adds the first unselected match on Enter', async () => {
    const { picker, changes } = setup({ selected: [repo('octo/api')] });
    await flush();

    typeInto(picker.input, 'octo');
    const event = pressKey(picker.input, 'Enter');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(changes, [[repo('octo/api'), repo('octo/web')]]);

    pressKey(picker.input, 'Enter');
    assert.equal(changes.length, 1);
  });

  it('moves the focus with the arrow keys', async () => {
    const { picker } = setup();
    await flush();
    const options = [
      ...picker.root.querySelectorAll<HTMLButtonElement>('.ghx-dependabot-picker__option'),
    ];
    assert.equal(options.length, 3);

    assert.equal(pressKey(picker.input, 'ArrowDown').defaultPrevented, true);
    assert.equal(document.activeElement, options[0]);
    pressKey(options[0] as HTMLButtonElement, 'ArrowDown');
    assert.equal(document.activeElement, options[1]);
    pressKey(options[1] as HTMLButtonElement, 'ArrowDown');
    pressKey(options[2] as HTMLButtonElement, 'ArrowDown');
    assert.equal(document.activeElement, options[2]);
    pressKey(options[2] as HTMLButtonElement, 'ArrowUp');
    assert.equal(document.activeElement, options[1]);
    pressKey(options[0] as HTMLButtonElement, 'ArrowUp');
    assert.equal(document.activeElement, picker.input);

    assert.equal(pressKey(options[0] as HTMLButtonElement, 'a').defaultPrevented, false);
    assert.equal(pressKey(picker.input, 'a').defaultPrevented, false);
  });

  it('disables further options once the maximum is reached', async () => {
    const { picker, changes } = setup({ max: 2, resultLimit: 2 });
    await flush();
    assert.equal(names(picker.root).length, 2);

    typeInto(picker.input, 'api');
    option(picker.root, 'octo/api').click();
    typeInto(picker.input, 'tools');
    option(picker.root, 'acme/tools').click();

    assert.equal(
      picker.root.querySelector('.ghx-dependabot-picker__selection .ghx-hint')?.textContent,
      'You can select up to 2 repositories.',
    );
    typeInto(picker.input, 'web');
    assert.equal(option(picker.root, 'octo/web').disabled, true);
    pressKey(picker.input, 'Enter');
    assert.equal(changes.length, 2);
    typeInto(picker.input, 'tools');
    assert.equal(option(picker.root, 'acme/tools').disabled, false);
  });

  it('offers the settings when the index is empty', async () => {
    const { picker, settingsOpened } = setup({}, async () => dataResult([]));
    await flush();

    assert.equal(picker.root.querySelector('.ghx-state__title')?.textContent, 'No repositories');
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(settingsOpened(), 1);
    assert.equal(picker.input.disabled, true);
  });

  it('shows an empty index without settings button where settings cannot be opened', async () => {
    const { picker } = setup({ onOpenSettings: null }, async () => dataResult([]));
    await flush();

    assert.equal(picker.root.querySelector('.ghx-state__title')?.textContent, 'No repositories');
    assert.equal(picker.root.querySelector('button'), null);
  });

  it('shows errors of an empty index and retries with a forced refresh', async () => {
    let calls = 0;
    const { picker, data, settingsOpened } = setup({}, async () => {
      calls += 1;
      return calls === 1
        ? dataResult([], { errors: [{ kind: 'no_tokens', message: 'none' }] })
        : dataResult(REPOS);
    });
    await flush();

    assert.equal(
      picker.root.querySelector('.ghx-state__title')?.textContent,
      'Could not load repositories',
    );
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(settingsOpened(), 1);

    buttonByText(picker.root, 'Retry').click();
    assert.ok(picker.root.querySelector('.ghx-state--loading'));
    await flush();
    assert.deepEqual(data.callsTo('repoIndex')[1], [{ forceRefresh: true }]);
    assert.equal(names(picker.root).length, 3);
  });

  it('shows a rejected index request as error', async () => {
    const { picker } = setup({ onOpenSettings: null }, async () => {
      throw new ApiError({ kind: 'unauthorized', message: 'bad token' });
    });
    await flush();

    assert.equal(
      picker.root.querySelector('.ghx-state__title')?.textContent,
      'Could not load repositories',
    );
    assert.ok(buttonByText(picker.root, 'Retry'));
    assert.throws(() => buttonByText(picker.root, 'Open settings'));
  });

  it('warns about partial errors above the list', async () => {
    const errors = [{ kind: 'forbidden' as const, message: 'no', owner: 'acme' }];
    const { picker, settingsOpened } = setup({}, async () => dataResult(REPOS, { errors }));
    await flush();

    const warning = picker.root.querySelector('.ghx-dependabot-picker__notices .ghx-notice');
    assert.match(warning?.textContent ?? '', /The token for acme lacks the permissions/);
    buttonByText(picker.root, 'Open settings').click();
    assert.equal(settingsOpened(), 1);
    assert.equal(names(picker.root).length, 3);
  });

  it('warns without settings button for errors unrelated to tokens', async () => {
    const errors = [{ kind: 'network' as const, message: 'offline' }];
    const { picker } = setup({}, async () => dataResult(REPOS, { errors }));
    await flush();

    assert.ok(picker.root.querySelector('.ghx-notice'));
    assert.throws(() => buttonByText(picker.root, 'Open settings'));
  });

  it('ignores answers after the signal was aborted', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const { picker, controller } = setup({}, () => pending.promise);
    controller.abort();
    pending.resolve(dataResult(REPOS));
    await flush();

    assert.ok(picker.root.querySelector('.ghx-state--loading'));
  });

  it('ignores rejections after the signal was aborted', async () => {
    const pending = deferred<DataResult<RepoSummary[]>>();
    const { picker, controller } = setup({}, () => pending.promise);
    controller.abort();
    pending.reject(new Error('late'));
    await flush();

    assert.ok(picker.root.querySelector('.ghx-state--loading'));
  });
});
