import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOKEN_STATUSES } from '../shared/tokens.ts';
import { NOW } from './fake-sender.fixture.ts';
import { describeExpiry, describeStatus } from './token-status.ts';

describe('describeStatus', () => {
  it('has a label and explanation for every status', () => {
    for (const status of TOKEN_STATUSES) {
      const description = describeStatus(status);
      assert.ok(description.label.length > 0);
      assert.ok(description.explanation.endsWith('.'));
    }
  });

  it('explains the statuses the user has to act on', () => {
    assert.match(describeStatus('pending_approval').explanation, /organization owner to approve/);
    assert.match(describeStatus('wrong_user').explanation, /another GitHub account/);
    assert.equal(describeStatus('valid').tone, 'success');
    assert.equal(describeStatus('unchecked').tone, 'neutral');
    assert.equal(describeStatus('pending_approval').tone, 'attention');
    assert.equal(describeStatus('expired').tone, 'danger');
  });
});

describe('describeExpiry', () => {
  const checked = { lastCheckedAt: '2026-11-26T11:00:00Z' };

  it('is unknown before the first check', () => {
    assert.deepEqual(describeExpiry({ expiresAt: null, lastCheckedAt: null }, NOW), {
      text: 'Expiry unknown',
      tone: 'muted',
      at: null,
    });
  });

  it('reports tokens without expiry date after a check', () => {
    assert.equal(describeExpiry({ expiresAt: null, ...checked }, NOW).text, 'Does not expire');
  });

  it('treats unparsable dates as unknown', () => {
    assert.equal(describeExpiry({ expiresAt: 'soon', ...checked }, NOW).text, 'Expiry unknown');
  });

  it('shows distant expiry dates without warning', () => {
    const expiry = describeExpiry({ expiresAt: '2027-06-01T12:00:00Z', ...checked }, NOW);

    assert.equal(expiry.text, 'Expires on Jun 1, 2027');
    assert.equal(expiry.tone, 'muted');
    assert.equal(expiry.at?.toISOString(), '2027-06-01T12:00:00.000Z');
  });

  it('warns within 14 days', () => {
    const at14 = describeExpiry({ expiresAt: '2026-12-10T12:00:00Z', ...checked }, NOW);
    const at15 = describeExpiry({ expiresAt: '2026-12-11T12:00:00Z', ...checked }, NOW);
    const at2 = describeExpiry({ expiresAt: '2026-11-28T06:00:00Z', ...checked }, NOW);

    assert.equal(at14.text, 'Expires in 14 days (Dec 10)');
    assert.equal(at14.tone, 'attention');
    assert.equal(at15.tone, 'muted');
    assert.equal(at2.text, 'Expires in 2 days (Nov 28)');
  });

  it('warns about expiry within a day', () => {
    const expiry = describeExpiry({ expiresAt: '2026-11-26T13:00:00Z', ...checked }, NOW);

    assert.equal(expiry.text, 'Expires within a day (Nov 26)');
    assert.equal(expiry.tone, 'attention');
  });

  it('flags expired tokens', () => {
    const expiry = describeExpiry({ expiresAt: '2026-11-26T12:00:00Z', ...checked }, NOW);

    assert.equal(expiry.text, 'Expired on Nov 26');
    assert.equal(expiry.tone, 'danger');
  });
});
