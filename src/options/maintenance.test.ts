import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { createFakeSender, deferred, rejectWith, settle } from './fake-sender.fixture.ts';
import { maintenance } from './maintenance.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

function clearButton(element: HTMLElement): HTMLButtonElement {
  const button = element.querySelector('button');
  assert.ok(button);
  return button;
}

describe('maintenance', () => {
  it('clears the cache with a busy state and a success notice', async () => {
    const pending = deferred<null>();
    const sender = createFakeSender({ 'cache.clear': () => pending.promise });
    const element = maintenance({ send: sender.send });

    clearButton(element).click();

    assert.deepEqual(sender.callsTo('cache.clear'), [{}]);
    assert.equal(clearButton(element).disabled, true);
    assert.equal(clearButton(element).textContent, 'Clearing...');

    pending.resolve(null);
    await settle();

    assert.equal(clearButton(element).disabled, false);
    assert.equal(clearButton(element).textContent, 'Clear cached data');
    const success = element.querySelector('.ghx-maintenance__status .ghx-notice--success');
    assert.equal(success?.textContent, 'Cached data cleared.');
  });

  it('shows an error and removes it on the next attempt', async () => {
    const sender = createFakeSender({
      'cache.clear': rejectWith({ kind: 'internal', message: 'Storage failed' }),
    });
    const element = maintenance({ send: sender.send });

    clearButton(element).click();
    await settle();

    const error = element.querySelector('.ghx-notice--danger');
    assert.match(error?.textContent ?? '', /Storage failed/);
    assert.equal(clearButton(element).disabled, false);

    sender.handlers['cache.clear'] = () => deferred<null>().promise;
    clearButton(element).click();
    assert.equal(element.querySelector('.ghx-notice'), null);
  });
});
