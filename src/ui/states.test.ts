import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { API_ERROR_KINDS } from '../shared/errors.ts';
import type { ApiErrorInfo } from '../shared/errors.ts';
import { button } from './forms.ts';
import { describeApiError, emptyState, errorState, isTokenError, loadingState } from './states.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('loadingState', () => {
  it('announces the default label politely', () => {
    const element = loadingState();

    assert.equal(element.getAttribute('role'), 'status');
    assert.equal(element.getAttribute('aria-live'), 'polite');
    assert.equal(element.textContent, 'Loading...');
    assert.equal(element.querySelector('.ghx-spinner')?.getAttribute('aria-hidden'), 'true');
  });

  it('accepts a custom label', () => {
    assert.equal(loadingState('Loading pull requests...').textContent, 'Loading pull requests...');
  });
});

describe('emptyState', () => {
  it('renders only the title by default', () => {
    const element = emptyState({ title: 'No pull requests' });

    assert.equal(element.className, 'ghx-state ghx-state--empty');
    assert.equal(element.querySelector('.ghx-state__title')?.textContent, 'No pull requests');
    assert.equal(element.querySelector('svg'), null);
    assert.equal(element.querySelector('.ghx-state__description'), null);
    assert.equal(element.querySelector('.ghx-state__actions'), null);
  });

  it('renders icon, description and actions', () => {
    const element = emptyState({
      title: 'Nothing here',
      description: 'Try another filter',
      icon: 'git-pull-request',
      actions: [button({ label: 'Configure' })],
    });

    assert.ok(element.querySelector('.ghx-icon--git-pull-request'));
    const description = element.querySelector('.ghx-state__description');
    assert.equal(description?.textContent, 'Try another filter');
    assert.equal(element.querySelectorAll('.ghx-state__actions button').length, 1);
  });
});

describe('isTokenError', () => {
  it('flags the kinds fixed on the options page', () => {
    const tokenKinds = API_ERROR_KINDS.filter(isTokenError);

    assert.deepEqual(tokenKinds, ['unauthorized', 'forbidden', 'no_tokens', 'no_token_for_owner']);
  });
});

describe('describeApiError', () => {
  it('has a sentence for every kind with and without owner', () => {
    for (const kind of API_ERROR_KINDS) {
      const withOwner = describeApiError({ kind, message: 'raw', owner: 'octo-org' });
      const withoutOwner = describeApiError({ kind, message: 'raw' });

      assert.match(withOwner, /\.$/, kind);
      assert.match(withoutOwner, /\.$/, kind);
      assert.doesNotMatch(withOwner, /raw/, kind);
    }
  });

  it('names the owner where it helps', () => {
    for (const kind of [
      'unauthorized',
      'forbidden',
      'sso_required',
      'pending_approval',
      'no_token_for_owner',
    ] as const) {
      assert.match(describeApiError({ kind, message: '', owner: 'octo-org' }), /octo-org/, kind);
    }
    assert.equal(
      describeApiError({ kind: 'unauthorized', message: '' }),
      'A token is invalid or has expired.',
    );
  });

  it('mentions when to retry after a rate limit', () => {
    assert.equal(
      describeApiError({ kind: 'rate_limited', message: '' }),
      'The GitHub API rate limit is exhausted.',
    );
    assert.match(
      describeApiError({ kind: 'rate_limited', message: '', retryAfter: 30 }),
      /Try again in 1 minute\.$/,
    );
    assert.match(
      describeApiError({ kind: 'rate_limited', message: '', retryAfter: 600 }),
      /Try again in 10 minutes\.$/,
    );
    assert.match(
      describeApiError({ kind: 'rate_limited', message: '', retryAfter: 0 }),
      /Try again in 1 minute\.$/,
    );
  });
});

describe('errorState', () => {
  const sso: ApiErrorInfo = {
    kind: 'sso_required',
    message: 'SSO needed',
    owner: 'octo-org',
    actionUrl: 'https://github.com/orgs/octo-org/sso?authorization_request=1',
  };

  it('renders an alert with the default title and no actions', () => {
    const element = errorState([]);

    assert.equal(element.getAttribute('role'), 'alert');
    assert.equal(element.querySelector('.ghx-state__title')?.textContent, 'Could not load data');
    assert.equal(element.querySelector('.ghx-errors'), null);
    assert.equal(element.querySelector('.ghx-state__actions'), null);
  });

  it('lists each error with description, detail and action link', () => {
    const element = errorState([sso, { kind: 'network', message: '' }], { title: 'Partial' });
    const items = element.querySelectorAll('.ghx-error');
    const link = items[0]?.querySelector('a');

    assert.equal(element.querySelector('.ghx-state__title')?.textContent, 'Partial');
    assert.equal(items.length, 2);
    assert.equal(items[0]?.getAttribute('data-kind'), 'sso_required');
    assert.match(items[0]?.querySelector('.ghx-error__text')?.textContent ?? '', /octo-org/);
    assert.equal(items[0]?.querySelector('.ghx-error__detail')?.textContent, 'SSO needed');
    assert.equal(link?.getAttribute('href'), sso.actionUrl);
    assert.equal(link?.getAttribute('target'), '_blank');
    assert.equal(link?.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(link?.textContent, 'Authorize token');
    assert.equal(items[1]?.querySelector('.ghx-error__detail'), null);
    assert.equal(items[1]?.querySelector('a'), null);
  });

  it('labels action links per kind', () => {
    const element = errorState([
      { kind: 'pending_approval', message: '', actionUrl: 'https://github.com/settings/tokens' },
      { kind: 'forbidden', message: '', actionUrl: 'https://github.com/settings/tokens' },
    ]);
    const links = [...element.querySelectorAll('a')].map((link) => link.textContent);

    assert.deepEqual(links, ['View request', 'Open on GitHub']);
  });

  it('drops action URLs that are not http(s)', () => {
    const element = errorState([
      { kind: 'sso_required', message: '', actionUrl: 'javascript:alert(1)' },
    ]);

    assert.equal(element.querySelector('a'), null);
  });

  it('keeps error messages as text', () => {
    const element = errorState([{ kind: 'internal', message: '<img src=x onerror=alert(1)>' }]);

    assert.equal(element.querySelector('img'), null);
    assert.equal(
      element.querySelector('.ghx-error__detail')?.textContent,
      '<img src=x onerror=alert(1)>',
    );
  });

  it('offers settings only for token errors and retry when requested', () => {
    let settings = 0;
    let retries = 0;
    const onOpenSettings = (): void => {
      settings++;
    };
    const onRetry = (): void => {
      retries++;
    };

    const tokenError = errorState([{ kind: 'unauthorized', message: '' }], {
      onOpenSettings,
      onRetry,
    });
    const buttons = [...tokenError.querySelectorAll('button')];
    buttons.forEach((element) => element.click());

    assert.deepEqual(
      buttons.map((element) => element.textContent),
      ['Open settings', 'Retry'],
    );
    assert.equal(settings, 1);
    assert.equal(retries, 1);

    const networkError = errorState([{ kind: 'network', message: '' }], { onOpenSettings });
    assert.equal(networkError.querySelector('button'), null);

    const withoutCallback = errorState([{ kind: 'no_tokens', message: '' }]);
    assert.equal(withoutCallback.querySelector('button'), null);
  });
});
