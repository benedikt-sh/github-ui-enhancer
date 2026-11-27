import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { TokenInfo } from '../shared/tokens.ts';
import { addTokenForm } from './add-token-form.ts';
import {
  createFakeSender,
  deferred,
  rejectWith,
  settle,
  tokenInfo,
} from './fake-sender.fixture.ts';
import type { FakeHandlers, FakeSender } from './fake-sender.fixture.ts';

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

const SECRET = 'github_pat_11AAAAAAA0_secretvalue1234';

interface Harness {
  readonly form: HTMLFormElement;
  readonly sender: FakeSender;
  readonly secret: HTMLInputElement;
  readonly owner: HTMLInputElement;
  readonly submit: HTMLButtonElement;
  readonly added: TokenInfo[];
  stale: number;
}

function mount(handlers: FakeHandlers = {}): Harness {
  const sender = createFakeSender(handlers);
  const added: TokenInfo[] = [];
  let harness: Harness | undefined;
  const form = addTokenForm({
    send: sender.send,
    onAdded: (info) => added.push(info),
    onStale: () => {
      if (harness) {
        harness.stale += 1;
      }
    },
  });
  document.body.append(form);
  const secret = form.querySelector<HTMLInputElement>('input[name="secret"]');
  const owner = form.querySelector<HTMLInputElement>('input[name="owner"]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  assert.ok(secret && owner && submit);
  harness = { form, sender, secret, owner, submit, added, stale: 0 };
  return harness;
}

function fill(harness: Harness, secret: string, owner = ''): void {
  harness.secret.value = secret;
  harness.owner.value = owner;
  harness.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function statusText(harness: Harness): string {
  return harness.form.querySelector('.ghx-add-token__status')?.textContent ?? '';
}

describe('addTokenForm', () => {
  it('renders a password input that browsers do not remember or check', () => {
    const { form, secret, owner, submit } = mount();

    assert.equal(secret.type, 'password');
    assert.equal(secret.getAttribute('autocomplete'), 'off');
    assert.equal(secret.getAttribute('spellcheck'), 'false');
    assert.equal(secret.required, true);
    assert.equal(owner.required, false);
    assert.equal(owner.getAttribute('autocomplete'), 'off');
    assert.equal(form.getAttribute('autocomplete'), 'off');
    assert.equal(submit.textContent, 'Add token');
    const labels = [...form.querySelectorAll('label')].map((label) => label.textContent);
    assert.deepEqual(labels, [
      'Fine-grained personal access token *',
      'Resource owner (optional)',
    ]);
  });

  it('adds the token, clears the inputs and reports the new entry', async () => {
    const pending = deferred<TokenInfo>();
    const harness = mount({ 'tokens.add': () => pending.promise });

    fill(harness, SECRET, ' my-org ');

    assert.deepEqual(harness.sender.callsTo('tokens.add'), [{ secret: SECRET, owner: 'my-org' }]);
    assert.equal(harness.submit.disabled, true);
    assert.equal(harness.submit.textContent, 'Adding...');
    assert.equal(harness.secret.disabled, true);
    assert.equal(harness.owner.disabled, true);

    fill(harness, SECRET);
    assert.equal(harness.sender.callsTo('tokens.add').length, 1, 'ignores submits while busy');

    const info = tokenInfo({ owner: 'my-org', ownerSource: 'manual', hint: 'wxyz' });
    pending.resolve(info);
    await settle();

    assert.equal(harness.secret.value, '');
    assert.equal(harness.owner.value, '');
    assert.equal(harness.submit.disabled, false);
    assert.equal(harness.submit.textContent, 'Add token');
    assert.deepEqual(harness.added, [info]);
    assert.equal(harness.stale, 0);
    assert.match(statusText(harness), /Token added.*ending in \.\.\.wxyz was added for my-org\./);
    assert.ok(!harness.form.textContent?.includes(SECRET), 'never renders the secret');
    assert.equal(document.activeElement, harness.secret);
  });

  it('leaves out an empty owner and names no owner when none was detected', async () => {
    const harness = mount({ 'tokens.add': () => tokenInfo({ owner: null, ownerSource: null }) });

    fill(harness, SECRET, '  ');
    await settle();

    assert.deepEqual(harness.sender.callsTo('tokens.add'), [{ secret: SECRET }]);
    assert.match(statusText(harness), /ending in \.\.\.abcd was added\.$/);
  });

  it('keeps the input when the background refuses the token', async () => {
    const classic = 'ghp_classic';
    const harness = mount({
      'tokens.add': rejectWith({
        kind: 'invalid_request',
        message: 'Classic personal access tokens are not supported.',
      }),
    });

    fill(harness, classic, 'my-org');
    await settle();

    assert.equal(harness.secret.value, classic);
    assert.equal(harness.owner.value, 'my-org');
    assert.equal(harness.secret.disabled, false);
    assert.equal(harness.stale, 0);
    assert.deepEqual(harness.added, []);
    const error = harness.form.querySelector('.ghx-notice--danger');
    const title = error?.querySelector('.ghx-notice__title')?.textContent;
    assert.equal(title, 'The token was not added.');
    assert.match(error?.textContent ?? '', /Classic personal access tokens are not supported/);
  });

  it('clears the secret and reloads the list after a transient failure', async () => {
    const harness = mount({
      'tokens.add': rejectWith({ kind: 'network', message: 'Failed to fetch' }),
    });

    fill(harness, SECRET);
    await settle();

    assert.equal(harness.secret.value, '');
    assert.equal(harness.stale, 1);
    const error = harness.form.querySelector('.ghx-notice--danger');
    assert.match(error?.textContent ?? '', /could not be reached/);
    assert.match(error?.textContent ?? '', /listed as not checked yet/);
    assert.ok(!harness.form.textContent?.includes(SECRET));
  });

  it('replaces the previous message on the next submit', async () => {
    const harness = mount({ 'tokens.add': rejectWith({ kind: 'internal', message: 'x' }) });
    fill(harness, SECRET);
    await settle();

    harness.sender.handlers['tokens.add'] = () => deferred<TokenInfo>().promise;
    fill(harness, SECRET);

    assert.equal(statusText(harness), '');
  });
});
