import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { ApiError } from '../shared/errors.ts';
import { errorNotice } from './error-notice.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

describe('errorNotice', () => {
  it('shows the description and the message of an ApiError', () => {
    const element = errorNotice(new ApiError({ kind: 'network', message: 'Failed to fetch' }));

    assert.ok(element.classList.contains('ghx-notice--danger'));
    assert.equal(element.getAttribute('role'), 'alert');
    assert.equal(
      element.querySelector('.ghx-notice__title')?.textContent,
      'GitHub could not be reached. Check your connection.',
    );
    const detail = element.querySelector('.ghx-options__error-detail');
    assert.equal(detail?.textContent, 'Failed to fetch');
    assert.equal(element.querySelector('.ghx-options__error-note'), null);
    assert.equal(element.querySelector('a'), null);
  });

  it('accepts a custom title, a note and plain errors without message', () => {
    const element = errorNotice(new Error(''), { title: 'Not added', note: 'Try again.' });

    assert.equal(element.querySelector('.ghx-notice__title')?.textContent, 'Not added');
    assert.equal(element.querySelector('.ghx-options__error-detail'), null);
    assert.equal(element.querySelector('.ghx-options__error-note')?.textContent, ' Try again.');
  });

  it('links safe action URLs in a new tab and drops unsafe ones', () => {
    const safe = errorNotice(
      new ApiError({
        kind: 'sso_required',
        message: 'SSO',
        actionUrl: 'https://github.com/orgs/octo-org/sso',
      }),
    );
    const link = safe.querySelector('a');
    assert.equal(link?.getAttribute('href'), 'https://github.com/orgs/octo-org/sso');
    assert.equal(link?.getAttribute('target'), '_blank');
    assert.equal(link?.getAttribute('rel'), 'noopener noreferrer');

    const unsafe = errorNotice(
      new ApiError({ kind: 'sso_required', message: 'SSO', actionUrl: 'javascript:alert(1)' }),
    );
    assert.equal(unsafe.querySelector('a'), null);
  });
});
