import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { RepoRef } from '../../shared/types.ts';
import { flush, NOW, summary } from './header-pins.fixture.ts';
import { createRepoPicker, PICKER_LIMIT } from './repo-picker.ts';
import type { RepoPickerOptions } from './repo-picker.ts';

const REPOS = [
  summary('octo', 'alpha', '2026-11-25T00:00:00Z'),
  summary('octo', 'beta', '2026-11-24T00:00:00Z'),
  summary('acme', 'gamma', '2026-11-23T00:00:00Z'),
];

interface Setup {
  readonly picked: RepoRef[];
  readonly cancelled: number[];
  readonly picker: ReturnType<typeof createRepoPicker>;
}

function setup(overrides: Partial<RepoPickerOptions> = {}): Setup {
  const picked: RepoRef[] = [];
  const cancelled: number[] = [];
  const picker = createRepoPicker({
    loadRepos: async () => REPOS,
    isExcluded: () => false,
    onPick: (repo) => picked.push(repo),
    onCancel: () => cancelled.push(1),
    now: () => NOW,
    ...overrides,
  });
  document.body.append(picker.root);
  return { picked, cancelled, picker };
}

function names(picker: Setup['picker']): string[] {
  return [...picker.root.querySelectorAll('[role="option"]')].map((option) => option.textContent);
}

function status(picker: Setup['picker']): HTMLElement {
  const element = picker.root.querySelector<HTMLElement>('.ghx-pin-picker__status');
  assert.ok(element !== null);
  return element;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function press(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

describe('createRepoPicker', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  it('shows a loading state and then the most recent repos', async () => {
    const { picker } = setup();
    assert.equal(status(picker).textContent, 'Loading repositories...');
    assert.equal(picker.input.getAttribute('role'), 'combobox');

    await flush();

    assert.deepEqual(names(picker), ['octo/alpha', 'octo/beta', 'acme/gamma']);
    assert.equal(status(picker).hidden, true);
    assert.equal(picker.input.getAttribute('aria-expanded'), 'true');
    assert.equal(
      picker.input.getAttribute('aria-activedescendant'),
      picker.root.querySelector('[role="option"]')?.id,
    );
  });

  it('filters fuzzily with highlights and hides excluded repos', async () => {
    const { picker } = setup({ isExcluded: (repo) => repo.name === 'beta' });
    await flush();
    assert.deepEqual(names(picker), ['octo/alpha', 'acme/gamma']);

    type(picker.input, 'gam');

    assert.deepEqual(names(picker), ['acme/gamma']);
    assert.equal(picker.root.querySelector('mark')?.textContent, 'gam');
  });

  it('shows at most the limit', async () => {
    const many = Array.from({ length: PICKER_LIMIT + 4 }, (_, index) =>
      summary('octo', `r${index}`),
    );
    const { picker } = setup({ loadRepos: async () => many });
    await flush();

    assert.equal(names(picker).length, PICKER_LIMIT);
  });

  it('reports when nothing matches and ignores keys then', async () => {
    const { picker, picked } = setup();
    await flush();

    type(picker.input, 'zzzz');

    assert.deepEqual(names(picker), []);
    assert.equal(status(picker).textContent, 'No matching repositories.');
    assert.equal(picker.input.getAttribute('aria-expanded'), 'false');
    assert.equal(picker.input.hasAttribute('aria-activedescendant'), false);
    press(picker.input, 'ArrowDown');
    press(picker.input, 'Enter');
    assert.deepEqual(picked, []);
  });

  it('moves with the arrow keys, wraps around and picks with Enter', async () => {
    const { picker, picked } = setup();
    await flush();
    const selected = (): string[] =>
      [...picker.root.querySelectorAll('[aria-selected="true"]')].map((el) => el.textContent);

    press(picker.input, 'ArrowUp');
    assert.deepEqual(selected(), ['acme/gamma']);
    press(picker.input, 'ArrowDown');
    assert.deepEqual(selected(), ['octo/alpha']);
    const event = press(picker.input, 'ArrowDown');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(selected(), ['octo/beta']);

    press(picker.input, 'Enter');
    assert.deepEqual(picked, [{ owner: 'octo', name: 'beta' }]);

    const other = press(picker.input, 'a');
    assert.equal(other.defaultPrevented, false);
  });

  it('picks on click without stealing the focus', async () => {
    const { picker, picked } = setup();
    await flush();
    const option = picker.root.querySelectorAll<HTMLElement>('[role="option"]')[2];
    assert.ok(option !== undefined);

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    option.click();

    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(picked, [{ owner: 'acme', name: 'gamma' }]);
  });

  it('cancels with Escape', async () => {
    const { picker, cancelled } = setup();
    const event = press(picker.input, 'Escape');

    assert.deepEqual(cancelled, [1]);
    assert.equal(event.defaultPrevented, true);
    type(picker.input, 'a');
    assert.deepEqual(names(picker), []);
    await flush();
  });

  it('reports a failed load', async () => {
    const { picker } = setup({ loadRepos: () => Promise.reject(new Error('down')) });
    await flush();

    assert.equal(status(picker).textContent, 'Could not load your repositories.');
  });
});
