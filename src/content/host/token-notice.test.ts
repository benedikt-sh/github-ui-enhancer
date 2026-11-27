import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { TokenInfo } from '../../shared/tokens.ts';
import { findTokenProblems, tokenNotice } from './token-notice.ts';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function token(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    id: 't1',
    owner: 'acme',
    ownerSource: 'detected',
    status: 'valid',
    login: 'octocat',
    expiresAt: null,
    lastCheckedAt: null,
    hint: 'abcd',
    ...overrides,
  };
}

const inDays = (days: number): string => new Date(NOW + days * DAY).toISOString();

describe('findTokenProblems', () => {
  it('reports a missing token', () => {
    const problems = findTokenProblems([], 'octocat', NOW);
    assert.equal(problems?.severity, 'danger');
    assert.equal(problems?.title, 'No access token configured');
  });

  it('returns null for healthy and unchecked tokens', () => {
    assert.equal(findTokenProblems([token()], 'octocat', NOW), null);
    assert.equal(findTokenProblems([token({ status: 'unchecked', login: null })], null, NOW), null);
    assert.equal(findTokenProblems([token({ expiresAt: inDays(30) })], 'octocat', NOW), null);
    assert.equal(findTokenProblems([token({ expiresAt: 'garbage' })], 'octocat', NOW), null);
  });

  it('compares logins case-insensitively', () => {
    assert.equal(findTokenProblems([token({ login: 'OctoCat' })], 'octocat', NOW), null);
  });

  it('reports when no token works', () => {
    const problems = findTokenProblems(
      [
        token({ status: 'expired' }),
        token({ status: 'invalid', owner: null }),
        token({ status: 'pending_approval', owner: 'corp' }),
      ],
      'octocat',
      NOW,
    );
    assert.deepEqual(problems, {
      severity: 'danger',
      title: 'No working access token',
      messages: [
        'The token for acme has expired.',
        'The token ending in abcd is invalid or was revoked.',
        'The token for corp is waiting for approval by an organization owner.',
      ],
    });
  });

  it('treats a token past its expiry date as expired', () => {
    const problems = findTokenProblems([token({ expiresAt: inDays(-1) })], 'octocat', NOW);
    assert.equal(problems?.severity, 'danger');
    assert.deepEqual(problems?.messages, ['The token for acme has expired.']);
  });

  it('warns about tokens of another account', () => {
    const problems = findTokenProblems(
      [
        token(),
        token({ owner: 'corp', login: 'someone' }),
        token({ status: 'wrong_user', login: null }),
      ],
      'octocat',
      NOW,
    );
    assert.deepEqual(problems, {
      severity: 'warning',
      title: 'Check your access tokens',
      messages: [
        'The token for corp belongs to someone, not to octocat.',
        'The token for acme belongs to another GitHub account.',
      ],
    });
  });

  it('does not compare logins without a page login', () => {
    assert.equal(findTokenProblems([token({ login: 'someone' })], null, NOW), null);
  });

  it('warns about tokens expiring within 14 days', () => {
    const problems = findTokenProblems(
      [token({ expiresAt: inDays(14) }), token({ owner: 'corp', expiresAt: inDays(0.5) })],
      'octocat',
      NOW,
    );
    assert.equal(problems?.severity, 'warning');
    assert.deepEqual(problems?.messages, [
      'The token for acme expires in 14 days.',
      'The token for corp expires in 1 day.',
    ]);
  });
});

describe('tokenNotice', () => {
  let dom: DomEnvironment;

  before(() => {
    dom = installDom();
  });

  after(async () => {
    await dom.cleanup();
  });

  it('renders a single message with a settings button', () => {
    let opened = 0;
    const element = tokenNotice(
      { severity: 'danger', title: 'No working access token', messages: ['Broken.'] },
      () => {
        opened += 1;
      },
    );
    assert.ok(element.classList.contains('ghx-notice--danger'));
    assert.equal(element.querySelector('.ghx-notice__message')?.textContent, 'Broken.');
    assert.equal(element.querySelector('ul'), null);
    element.querySelector('button')?.click();
    assert.equal(opened, 1);
  });

  it('renders several messages as a list', () => {
    const element = tokenNotice(
      { severity: 'warning', title: 'Check', messages: ['One.', 'Two.'] },
      () => undefined,
    );
    assert.ok(element.classList.contains('ghx-notice--warning'));
    assert.deepEqual(
      [...element.querySelectorAll('.ghx-host-notice-list li')].map((item) => item.textContent),
      ['One.', 'Two.'],
    );
  });
});
