import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { createFakeMessaging } from '../../test/fakes/runtime.ts';
import { createRequestSender, isRequestMessage } from '../shared/messages.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import {
  createFakeSender,
  deferred,
  NOW,
  rejectWith,
  settle,
  tokenInfo,
} from './fake-sender.fixture.ts';
import { renderOptionsPage } from './options-page.ts';

let dom: DomEnvironment;
let root: HTMLElement;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

afterEach(() => {
  document.body.replaceChildren();
});

function createRoot(): HTMLElement {
  root = document.createElement('main');
  root.id = 'ghx-options';
  document.body.append(root);
  return root;
}

function headings(): (string | null)[] {
  return [...root.querySelectorAll('h1, h2, h3')].map((heading) => heading.textContent);
}

function tokenIds(): (string | undefined)[] {
  return [...root.querySelectorAll<HTMLElement>('.ghx-token')].map((entry) => entry.dataset['id']);
}

describe('renderOptionsPage', () => {
  it('renders guidance, token list, add form and maintenance', async () => {
    const sender = createFakeSender({ 'tokens.list': () => [tokenInfo()] });
    const page = renderOptionsPage(createRoot(), { send: sender.send, now: () => NOW });

    assert.ok(root.classList.contains('ghx-options'));
    assert.ok(root.querySelector('.ghx-state--loading'));
    await page.loaded;

    assert.deepEqual(headings(), [
      'GitHub UI Enhancer',
      'Access tokens',
      'Your tokens',
      'Add a token',
      'Maintenance',
    ]);
    assert.ok(root.querySelector('.ghx-guidance'));
    assert.ok(root.querySelector('form.ghx-add-token'));
    assert.ok(root.querySelector('.ghx-maintenance'));
    assert.deepEqual(tokenIds(), ['token-1']);
    assert.match(root.textContent ?? '', /Last checked 1 hour ago/);
  });

  it('uses the current time by default', async () => {
    const sender = createFakeSender({
      'tokens.list': () => [tokenInfo({ lastCheckedAt: new Date().toISOString() })],
    });
    await renderOptionsPage(createRoot(), { send: sender.send }).loaded;

    assert.match(root.textContent ?? '', /Last checked just now/);
  });

  it('shows a newly added token in the list', async () => {
    const added = tokenInfo({ id: 'token-2', hint: 'wxyz' });
    const sender = createFakeSender({ 'tokens.list': () => [], 'tokens.add': () => added });
    await renderOptionsPage(createRoot(), { send: sender.send, now: () => NOW }).loaded;
    assert.equal(root.querySelector('.ghx-state__title')?.textContent, 'No tokens yet');

    const secret = root.querySelector<HTMLInputElement>('input[name="secret"]');
    assert.ok(secret);
    secret.value = 'github_pat_new';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    assert.deepEqual(tokenIds(), ['token-2']);
    assert.equal(root.querySelector('.ghx-token-list .ghx-state'), null);
  });

  it('reloads the list when adding fails after the token may have been stored', async () => {
    const lists: TokenInfo[][] = [[], [tokenInfo({ status: 'unchecked' })]];
    const sender = createFakeSender({
      'tokens.list': () => lists.shift() ?? [],
      'tokens.add': rejectWith({ kind: 'rate_limited', message: 'API rate limit exceeded' }),
    });
    await renderOptionsPage(createRoot(), { send: sender.send, now: () => NOW }).loaded;

    const secret = root.querySelector<HTMLInputElement>('input[name="secret"]');
    assert.ok(secret);
    secret.value = 'github_pat_new';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    assert.equal(sender.callsTo('tokens.list').length, 2);
    assert.deepEqual(tokenIds(), ['token-1']);
    assert.match(root.querySelector('.ghx-add-token')?.textContent ?? '', /rate limit/);
  });

  it('reloads on request', async () => {
    const pending = deferred<TokenInfo[]>();
    const lists = [Promise.resolve([]), pending.promise];
    const sender = createFakeSender({ 'tokens.list': () => lists.shift() ?? [] });
    const page = renderOptionsPage(createRoot(), { send: sender.send, now: () => NOW });
    await page.loaded;

    const reloaded = page.reload();
    assert.ok(root.querySelector('.ghx-state--loading'));
    pending.resolve([tokenInfo()]);
    await reloaded;

    assert.deepEqual(tokenIds(), ['token-1']);
  });
});

describe('renderOptionsPage with the messaging runtime', () => {
  it('shows an error state with retry when the background is unreachable', async () => {
    const messaging = createFakeMessaging();
    const send = createRequestSender(messaging.extensionPage);
    await renderOptionsPage(createRoot(), { send, now: () => NOW }).loaded;

    const state = root.querySelector('.ghx-state--error');
    assert.equal(state?.querySelector('.ghx-state__title')?.textContent, 'Could not load tokens');
    assert.match(state?.textContent ?? '', /Receiving end does not exist/);

    messaging.addListener((message, _sender, sendResponse) => {
      assert.ok(isRequestMessage(message));
      assert.equal(message.op, 'tokens.list');
      sendResponse({ ok: true, result: [tokenInfo()] });
      return false;
    });
    const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    retry?.click();
    await settle();

    assert.deepEqual(tokenIds(), ['token-1']);
  });
});
