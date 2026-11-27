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
import { tokenEntry } from './token-entry.ts';
import { describeStatus } from './token-status.ts';
import type { TokenEntryView } from './token-entry.ts';

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

interface Harness {
  readonly view: TokenEntryView;
  readonly sender: FakeSender;
  readonly removed: string[];
  stale: number;
}

function mount(info: TokenInfo = tokenInfo(), handlers: FakeHandlers = {}): Harness {
  const sender = createFakeSender(handlers);
  const removed: string[] = [];
  const harness: Harness = {
    sender,
    removed,
    stale: 0,
    view: tokenEntry(info, {
      send: sender.send,
      now: () => NOW,
      onRemoved: (id) => removed.push(id),
      onStale: () => {
        harness.stale += 1;
      },
    }),
  };
  document.body.append(harness.view.element);
  return harness;
}

function action(view: TokenEntryView, name: string): HTMLButtonElement {
  const element = view.element.querySelector<HTMLButtonElement>(`button[data-action="${name}"]`);
  assert.ok(element, `button ${name} exists`);
  return element;
}

function ownerInput(view: TokenEntryView): HTMLInputElement {
  const input = view.element.querySelector<HTMLInputElement>('input[data-action="owner-input"]');
  assert.ok(input);
  return input;
}

function text(view: TokenEntryView, selector: string): string | null | undefined {
  return view.element.querySelector(selector)?.textContent;
}

function typeOwner(view: TokenEntryView, value: string): void {
  const input = ownerInput(view);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitOwner(view: TokenEntryView): void {
  const form = view.element.querySelector('form');
  assert.ok(form);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('tokenEntry rendering', () => {
  it('shows owner, status, account, expiry, last check and hint', () => {
    const { view } = mount();
    const { element } = view;

    assert.equal(view.id, 'token-1');
    assert.equal(element.dataset['id'], 'token-1');
    assert.equal(element.dataset['status'], 'valid');
    assert.equal(element.getAttribute('aria-busy'), 'false');
    assert.equal(text(view, '.ghx-token__owner'), 'octo-org');
    assert.equal(text(view, '.ghx-token__owner-source'), 'detected');
    assert.equal(text(view, '.ghx-token-badge'), 'Valid');
    assert.ok(element.querySelector('.ghx-token-badge--success'));
    assert.equal(text(view, '.ghx-token__explanation'), describeStatus('valid').explanation);
    const metaItems = element.querySelectorAll('.ghx-token__meta-item');
    const items = [...metaItems].map((li) => li.textContent);
    assert.deepEqual(items, [
      'Account octocat',
      'Expires on Jun 1, 2027',
      'Last checked 1 hour ago',
      'Token ending in ...abcd',
    ]);
    const expiry = element.querySelector('.ghx-token__expiry time');
    assert.equal(expiry?.getAttribute('datetime'), '2027-06-01T12:00:00.000Z');
    assert.ok(expiry?.getAttribute('title'));
    assert.ok(element.querySelector('.ghx-token__expiry.ghx-tone--muted'));
    assert.equal(element.querySelector('form'), null);
    assert.equal(element.querySelector('.ghx-notice'), null);
  });

  it('marks manual owners', () => {
    const { view } = mount(tokenInfo({ ownerSource: 'manual' }));

    assert.equal(text(view, '.ghx-token__owner-source'), 'manual');
  });

  it('describes unknown owners and unchecked tokens', () => {
    const { view } = mount(
      tokenInfo({
        owner: null,
        ownerSource: null,
        status: 'unchecked',
        login: null,
        expiresAt: null,
        lastCheckedAt: null,
      }),
    );

    assert.equal(text(view, '.ghx-token__owner'), 'Owner unknown - set it manually');
    assert.equal(view.element.querySelector('.ghx-token__owner-source'), null);
    assert.equal(text(view, '.ghx-token-badge'), 'Not checked');
    const items = [...view.element.querySelectorAll('.ghx-token__meta-item')];
    assert.deepEqual(
      items.map((li) => li.textContent),
      ['Account unknown', 'Expiry unknown', 'Never checked', 'Token ending in ...abcd'],
    );
    assert.equal(view.element.querySelector('.ghx-token__expiry time'), null);
  });

  it('shows a detected owner without source marker', () => {
    const { view } = mount(tokenInfo({ ownerSource: null }));

    assert.equal(view.element.querySelector('.ghx-token__owner-source'), null);
  });

  it('warns about expiring and expired tokens', () => {
    const soon = mount(tokenInfo({ expiresAt: '2026-12-01T12:00:00Z' })).view;
    const gone = mount(tokenInfo({ status: 'expired', expiresAt: '2026-11-01T12:00:00Z' })).view;

    assert.ok(soon.element.querySelector('.ghx-token__expiry.ghx-tone--attention'));
    assert.ok(gone.element.querySelector('.ghx-token__expiry.ghx-tone--danger'));
    assert.ok(gone.element.querySelector('.ghx-token-badge--danger'));
  });

  it('updates with new data from the background', () => {
    const { view } = mount();

    view.update(tokenInfo({ status: 'pending_approval' }));

    assert.equal(view.element.dataset['status'], 'pending_approval');
    assert.equal(text(view, '.ghx-token-badge'), 'Pending approval');
    assert.match(text(view, '.ghx-token__explanation') ?? '', /approve/);
  });
});

describe('tokenEntry check again', () => {
  it('shows a busy state and the validated token', async () => {
    const pending = deferred<TokenInfo>();
    const { view, sender } = mount(tokenInfo({ status: 'unchecked' }), {
      'tokens.validate': () => pending.promise,
    });

    action(view, 'validate').click();

    assert.deepEqual(sender.callsTo('tokens.validate'), [{ id: 'token-1' }]);
    assert.equal(view.element.getAttribute('aria-busy'), 'true');
    assert.equal(action(view, 'validate').textContent, 'Checking...');
    assert.equal(action(view, 'validate').disabled, true);
    assert.equal(action(view, 'owner').disabled, true);
    assert.equal(action(view, 'remove').disabled, true);

    pending.resolve(tokenInfo({ status: 'valid' }));
    await settle();

    assert.equal(view.element.getAttribute('aria-busy'), 'false');
    assert.equal(action(view, 'validate').textContent, 'Check again');
    assert.equal(action(view, 'validate').disabled, false);
    assert.equal(text(view, '.ghx-token-badge'), 'Valid');
    assert.equal(document.activeElement, action(view, 'validate'));
  });

  it('shows an error, reports stale data and clears the error on the next attempt', async () => {
    const harness = mount(tokenInfo(), {
      'tokens.validate': rejectWith({ kind: 'network', message: 'Failed to fetch' }),
    });
    const { view, sender } = harness;

    action(view, 'validate').click();
    await settle();

    assert.equal(harness.stale, 1);
    assert.match(text(view, '.ghx-notice--danger') ?? '', /could not be reached.*Failed to fetch/);
    assert.equal(text(view, '.ghx-token-badge'), 'Valid');

    view.update(tokenInfo({ lastCheckedAt: '2026-11-26T11:30:00Z' }));
    assert.ok(view.element.querySelector('.ghx-notice--danger'), 'error survives updates');

    sender.handlers['tokens.validate'] = () => tokenInfo();
    action(view, 'validate').click();
    assert.equal(view.element.querySelector('.ghx-notice'), null);
    await settle();
    assert.equal(view.element.querySelector('.ghx-notice'), null);
  });
});

describe('tokenEntry set owner', () => {
  it('opens an empty inline form for detected owners and focuses it', () => {
    const { view } = mount();

    action(view, 'owner').click();

    const input = ownerInput(view);
    assert.equal(input.value, '');
    assert.equal(input.placeholder, 'Detect automatically');
    assert.equal(document.activeElement, input);
    assert.match(text(view, '.ghx-hint') ?? '', /Leave empty to detect it/);
    assert.equal(view.element.querySelector('.ghx-token__actions'), null);
  });

  it('prefills a manual owner', () => {
    const { view } = mount(tokenInfo({ owner: 'my-org', ownerSource: 'manual' }));

    action(view, 'owner').click();

    assert.equal(ownerInput(view).value, 'my-org');
  });

  it('saves a trimmed owner and returns to the view', async () => {
    const pending = deferred<TokenInfo>();
    const { view, sender } = mount(tokenInfo(), { 'tokens.setOwner': () => pending.promise });

    action(view, 'owner').click();
    typeOwner(view, '  other-org ');
    submitOwner(view);

    assert.deepEqual(sender.callsTo('tokens.setOwner'), [{ id: 'token-1', owner: 'other-org' }]);
    assert.equal(ownerInput(view).disabled, true);
    assert.equal(ownerInput(view).value, '  other-org ');
    assert.equal(action(view, 'owner').textContent, 'Saving...');
    assert.equal(action(view, 'cancel-owner').disabled, true);

    submitOwner(view);
    ownerInput(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(sender.callsTo('tokens.setOwner').length, 1, 'ignores input while busy');
    assert.ok(view.element.querySelector('form'), 'Escape does not cancel while busy');

    pending.resolve(tokenInfo({ owner: 'other-org', ownerSource: 'manual' }));
    await settle();

    assert.equal(view.element.querySelector('form'), null);
    assert.equal(text(view, '.ghx-token__owner'), 'other-org');
    assert.equal(text(view, '.ghx-token__owner-source'), 'manual');
    assert.equal(document.activeElement, action(view, 'owner'));
  });

  it('detects the owner again when the input is empty', async () => {
    const { view, sender } = mount(tokenInfo({ owner: 'my-org', ownerSource: 'manual' }), {
      'tokens.setOwner': () => tokenInfo(),
    });

    action(view, 'owner').click();
    typeOwner(view, '   ');
    submitOwner(view);
    await settle();

    assert.deepEqual(sender.callsTo('tokens.setOwner'), [{ id: 'token-1', owner: null }]);
    assert.equal(text(view, '.ghx-token__owner-source'), 'detected');
  });

  it('keeps the form open with the error when saving fails', async () => {
    const harness = mount(tokenInfo(), {
      'tokens.setOwner': rejectWith({
        kind: 'invalid_request',
        message: '"-x" is not a valid GitHub account or organization name.',
      }),
    });
    const { view } = harness;

    action(view, 'owner').click();
    typeOwner(view, '-x');
    submitOwner(view);
    await settle();

    assert.equal(harness.stale, 1);
    assert.equal(ownerInput(view).value, '-x');
    assert.equal(ownerInput(view).disabled, false);
    assert.match(text(view, '.ghx-notice--danger') ?? '', /not a valid GitHub account/);
  });

  it('keeps the draft and focus when the entry updates while editing', () => {
    const { view } = mount();

    action(view, 'owner').click();
    typeOwner(view, 'draft');
    view.update(tokenInfo({ status: 'unchecked' }));

    assert.equal(ownerInput(view).value, 'draft');
    assert.equal(document.activeElement, ownerInput(view));
  });

  it('cancels with the button or Escape', () => {
    const { view } = mount();

    action(view, 'owner').click();
    action(view, 'cancel-owner').click();
    assert.equal(view.element.querySelector('form'), null);
    assert.equal(document.activeElement, action(view, 'owner'));

    action(view, 'owner').click();
    ownerInput(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    assert.ok(view.element.querySelector('form'));
    ownerInput(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(view.element.querySelector('form'), null);
  });
});

describe('tokenEntry remove', () => {
  it('asks for confirmation and can be cancelled', () => {
    const { view, sender } = mount();

    action(view, 'remove').click();

    assert.match(text(view, '.ghx-token__confirm-text') ?? '', /Remove the token for octo-org\?/);
    assert.equal(document.activeElement, action(view, 'confirm-remove'));
    assert.equal(view.element.querySelector('.ghx-token__actions'), null);

    action(view, 'cancel-remove').click();

    assert.equal(view.element.querySelector('.ghx-token__confirm'), null);
    assert.equal(document.activeElement, action(view, 'remove'));
    assert.equal(sender.calls.length, 0);
  });

  it('names tokens without owner in the confirmation', () => {
    const { view } = mount(tokenInfo({ owner: null, ownerSource: null }));

    action(view, 'remove').click();

    assert.match(text(view, '.ghx-token__confirm-text') ?? '', /Remove the token for this token\?/);
  });

  it('removes the token after confirmation', async () => {
    const pending = deferred<null>();
    const harness = mount(tokenInfo(), { 'tokens.remove': () => pending.promise });
    const { view, sender } = harness;

    action(view, 'remove').click();
    action(view, 'confirm-remove').click();

    assert.deepEqual(sender.callsTo('tokens.remove'), [{ id: 'token-1' }]);
    assert.equal(action(view, 'confirm-remove').textContent, 'Removing...');
    assert.equal(action(view, 'confirm-remove').disabled, true);
    assert.equal(action(view, 'cancel-remove').disabled, true);

    pending.resolve(null);
    await settle();

    assert.deepEqual(harness.removed, ['token-1']);
    assert.equal(harness.stale, 0);
  });

  it('shows an error when removing fails', async () => {
    const harness = mount(tokenInfo(), {
      'tokens.remove': rejectWith({ kind: 'internal', message: 'Storage failed' }),
    });
    const { view } = harness;

    action(view, 'remove').click();
    action(view, 'confirm-remove').click();
    await settle();

    assert.deepEqual(harness.removed, []);
    assert.equal(harness.stale, 1);
    assert.equal(view.element.querySelector('.ghx-token__confirm'), null);
    assert.match(text(view, '.ghx-notice--danger') ?? '', /Something went wrong.*Storage failed/);
  });
});
