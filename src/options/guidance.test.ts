import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { guidance, NEW_TOKEN_URL, REQUIRED_PERMISSIONS } from './guidance.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

describe('guidance', () => {
  it('links to the token creation page in a new tab', () => {
    const links = guidance().querySelectorAll('a');

    assert.equal(links.length, 1);
    assert.equal(links[0]?.getAttribute('href'), NEW_TOKEN_URL);
    assert.equal(links[0]?.getAttribute('target'), '_blank');
    assert.equal(links[0]?.getAttribute('rel'), 'noopener noreferrer');
  });

  it('lists the read-only permissions and repository access', () => {
    const element = guidance();
    const permissions = [...element.querySelectorAll('.ghx-guidance__permissions li')];

    assert.deepEqual(
      permissions.map((item) => item.textContent),
      [...REQUIRED_PERMISSIONS],
    );
    assert.match(element.textContent ?? '', /Read-only/);
    assert.match(element.textContent ?? '', /All repositories/);
  });

  it('explains organization policies, classic tokens, expiry and storage', () => {
    const text = guidance().textContent ?? '';

    assert.match(text, /one for each organization/);
    assert.match(text, /must allow fine-grained tokens/);
    assert.match(text, /pending approval/);
    assert.match(text, /Classic tokens are not supported because they always allow writing/);
    assert.match(text, /warns 14 days ahead/);
    assert.match(text, /never synced/);
  });
});
