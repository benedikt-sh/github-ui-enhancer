import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import {
  createFakeSender,
  deferred,
  NOW,
  rejectWith,
  settle,
  tokenInfo,
} from './fake-sender.fixture.ts';
import type { FakeHandlers, FakeSender } from './fake-sender.fixture.ts';
import { tokenList } from './token-list.ts';
import type { TokenListView } from './token-list.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

afterEach(() => {
  document.body.replaceChildren();
});

function mount(handlers: FakeHandlers = {}): { view: TokenListView; sender: FakeSender } {
  const sender = createFakeSender(handlers);
  const view = tokenList({ send: sender.send, now: () => NOW });
  document.body.append(view.element);
  return { view, sender };
}

function ids(view: TokenListView): (string | undefined)[] {
  return [...view.element.querySelectorAll<HTMLElement>('.ghx-token')].map(
    (entry) => entry.dataset['id'],
  );
}

function entryButton(view: TokenListView, id: string, action: string): HTMLButtonElement {
  const element = view.element.querySelector<HTMLButtonElement>(
    `.ghx-token[data-id="${id}"] button[data-action="${action}"]`,
  );
  assert.ok(element, `${action} of ${id}`);
  return element;
}

const first = tokenInfo({ id: 'a', hint: 'aaaa' });
const second = tokenInfo({ id: 'b', owner: 'octocat', hint: 'bbbb' });

describe('tokenList load', () => {
  it('shows a loading state, then the tokens in order', async () => {
    const pending = deferred<TokenInfo[]>();
    const { view, sender } = mount({ 'tokens.list': () => pending.promise });

    const loaded = view.load();

    const loading = view.element.querySelector('.ghx-state--loading');
    assert.equal(loading?.textContent, 'Loading tokens...');
    pending.resolve([first, second]);
    await loaded;

    assert.deepEqual(sender.callsTo('tokens.list'), [{}]);
    assert.equal(view.element.querySelector('.ghx-state'), null);
    assert.equal(view.element.querySelector('ul')?.getAttribute('aria-label'), 'Access tokens');
    assert.deepEqual(ids(view), ['a', 'b']);
  });

  it('shows an empty state without tokens', async () => {
    const { view } = mount({ 'tokens.list': () => [] });

    await view.load();

    assert.equal(view.element.querySelector('.ghx-state__title')?.textContent, 'No tokens yet');
    assert.equal(view.element.querySelector('ul'), null);
  });

  it('shows an error state with retry', async () => {
    const { view, sender } = mount({
      'tokens.list': rejectWith({
        kind: 'internal',
        message: 'Could not establish connection. Receiving end does not exist.',
      }),
    });

    await view.load();

    const state = view.element.querySelector('.ghx-state--error');
    assert.equal(state?.querySelector('.ghx-state__title')?.textContent, 'Could not load tokens');
    assert.match(state?.textContent ?? '', /Receiving end does not exist/);

    sender.handlers['tokens.list'] = () => [first];
    const retry = [...view.element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Retry',
    );
    retry?.click();
    await settle();

    assert.deepEqual(ids(view), ['a']);
    assert.equal(sender.callsTo('tokens.list').length, 2);
  });

  it('applies only the latest of overlapping requests', async () => {
    const slow = deferred<TokenInfo[]>();
    const responses = [slow.promise, Promise.resolve([second])];
    const { view } = mount({ 'tokens.list': () => responses.shift() ?? Promise.resolve([]) });

    const firstLoad = view.load();
    await view.load();
    slow.resolve([first]);
    await firstLoad;

    assert.deepEqual(ids(view), ['b']);
  });

  it('ignores the failure of an outdated request', async () => {
    const slow = deferred<TokenInfo[]>();
    const responses = [slow.promise, Promise.resolve([second])];
    const { view } = mount({ 'tokens.list': () => responses.shift() ?? Promise.resolve([]) });

    const firstLoad = view.load();
    await view.load();
    slow.reject(new Error('late'));
    await firstLoad;

    assert.deepEqual(ids(view), ['b']);
    assert.equal(view.element.querySelector('.ghx-state--error'), null);
  });
});

describe('tokenList refresh', () => {
  it('reconciles entries and keeps their element and state', async () => {
    const responses: TokenInfo[][] = [
      [first, second],
      [tokenInfo({ id: 'c' }), { ...first, status: 'expired' }],
    ];
    const { view } = mount({ 'tokens.list': () => responses.shift() ?? [] });
    await view.load();
    const elementA = view.element.querySelector('.ghx-token[data-id="a"]');
    entryButton(view, 'a', 'remove').click();

    const refreshed = view.refresh();
    assert.equal(view.element.querySelector('.ghx-state--loading'), null);
    await refreshed;

    assert.deepEqual(ids(view), ['c', 'a']);
    const updatedA = view.element.querySelector<HTMLElement>('.ghx-token[data-id="a"]');
    assert.equal(updatedA, elementA);
    assert.equal(updatedA?.dataset['status'], 'expired');
    assert.ok(updatedA?.querySelector('.ghx-token__confirm'), 'confirmation stays open');
  });

  it('keeps the shown entries when a refresh fails', async () => {
    const { view, sender } = mount({ 'tokens.list': () => [first] });
    await view.load();

    sender.handlers['tokens.list'] = rejectWith({ kind: 'internal', message: 'gone' });
    await view.refresh();

    assert.deepEqual(ids(view), ['a']);
    assert.equal(view.element.querySelector('.ghx-state--error'), null);
  });

  it('refreshes after a failed entry action', async () => {
    const { view, sender } = mount({
      'tokens.list': () => [first],
      'tokens.validate': rejectWith({ kind: 'network', message: 'offline' }),
    });
    await view.load();

    entryButton(view, 'a', 'validate').click();
    await settle();

    assert.equal(sender.callsTo('tokens.list').length, 2);
    assert.ok(view.element.querySelector('.ghx-token[data-id="a"] .ghx-notice--danger'));
  });

  it('removes entries and shows the empty state after the last one', async () => {
    const { view } = mount({ 'tokens.list': () => [first, second], 'tokens.remove': () => null });
    await view.load();

    entryButton(view, 'a', 'remove').click();
    entryButton(view, 'a', 'confirm-remove').click();
    await settle();
    assert.deepEqual(ids(view), ['b']);

    entryButton(view, 'b', 'remove').click();
    entryButton(view, 'b', 'confirm-remove').click();
    await settle();
    assert.deepEqual(ids(view), []);
    assert.equal(view.element.querySelector('.ghx-state__title')?.textContent, 'No tokens yet');
  });
});

describe('tokenList upsert', () => {
  it('adds new tokens and replaces the empty state', async () => {
    const { view } = mount({ 'tokens.list': () => [] });
    await view.load();

    view.upsert(first);
    view.upsert(second);

    assert.equal(view.element.querySelector('.ghx-state'), null);
    assert.deepEqual(ids(view), ['a', 'b']);
  });

  it('updates known tokens in place', async () => {
    const { view } = mount({ 'tokens.list': () => [first] });
    await view.load();

    view.upsert({ ...first, status: 'invalid' });

    assert.deepEqual(ids(view), ['a']);
    assert.equal(
      view.element.querySelector<HTMLElement>('.ghx-token')?.dataset['status'],
      'invalid',
    );
  });
});
