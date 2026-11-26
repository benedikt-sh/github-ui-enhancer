import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { PullRequestItem } from '../shared/types.ts';
import {
  checkStatus,
  pullRequestRow,
  pullRequestStatus,
  reviewStatus,
} from './pull-request-row.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const NOW = '2026-11-26T12:00:00Z';

function pullRequest(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  return {
    id: 'PR_1',
    number: 123,
    title: 'Add widgets',
    url: 'https://github.com/octo/repo/pull/123',
    repo: { owner: 'octo', name: 'repo' },
    author: {
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      url: 'https://github.com/octocat',
    },
    state: 'open',
    isDraft: false,
    reviewDecision: null,
    checkState: null,
    labels: [],
    commentCount: 0,
    createdAt: '2026-11-20T12:00:00Z',
    updatedAt: '2026-11-26T11:55:00Z',
    ...overrides,
  };
}

describe('pullRequestStatus', () => {
  it('maps every state', () => {
    assert.deepEqual(pullRequestStatus({ state: 'open', isDraft: false }), {
      icon: 'git-pull-request',
      tone: 'success',
      label: 'Open pull request',
    });
    const draft = pullRequestStatus({ state: 'open', isDraft: true });
    const merged = pullRequestStatus({ state: 'merged', isDraft: false });
    const closed = pullRequestStatus({ state: 'closed', isDraft: true });

    assert.equal(draft.icon, 'git-pull-request-draft');
    assert.equal(merged.tone, 'done');
    assert.equal(closed.icon, 'git-pull-request-closed');
  });
});

describe('reviewStatus and checkStatus', () => {
  it('map every review decision', () => {
    assert.equal(reviewStatus('approved').tone, 'success');
    assert.equal(reviewStatus('changes_requested').tone, 'danger');
    assert.equal(reviewStatus('review_required').label, 'Review required');
  });

  it('map every check state', () => {
    assert.equal(checkStatus('success').icon, 'check');
    assert.equal(checkStatus('failure').tone, 'danger');
    assert.equal(checkStatus('error').tone, 'danger');
    assert.equal(checkStatus('pending').tone, 'attention');
    assert.equal(checkStatus('expected').icon, 'dot-fill');
  });
});

describe('pullRequestRow', () => {
  it('renders an open pull request without extras', () => {
    const row = pullRequestRow(pullRequest(), { now: NOW });
    const meta = [...row.querySelectorAll('.ghx-row__meta-item')].map((item) => item.textContent);

    assert.ok(row.classList.contains('ghx-row--pull-request'));
    assert.equal(row.dataset['id'], 'PR_1');
    const stateIcon = row.querySelector('.ghx-row__icon svg');
    assert.equal(stateIcon?.getAttribute('aria-label'), 'Open pull request');
    assert.equal(row.querySelector('.ghx-row__repo')?.textContent, 'octo/repo');
    assert.equal(row.querySelector('a.ghx-row__title')?.getAttribute('href'), pullRequest().url);
    assert.deepEqual(meta, ['#123', 'by octocat', 'updated 5 minutes ago']);
    assert.equal(row.querySelector('.ghx-row__side'), null);
  });

  it('renders review decision, checks, comments, labels and hides the repo', () => {
    const row = pullRequestRow(
      pullRequest({
        state: 'merged',
        reviewDecision: 'approved',
        checkState: 'failure',
        commentCount: 4,
        labels: [{ name: 'enhancement', color: 'a2eeef' }],
        author: null,
      }),
      { now: NOW, showRepo: false },
    );

    assert.equal(row.querySelector('.ghx-row__repo'), null);
    assert.ok(row.querySelector('.ghx-row__icon.ghx-tone--done'));
    assert.equal(row.querySelector('.ghx-status-text')?.textContent, 'Approved');
    assert.match(row.querySelector('.ghx-row__meta')?.textContent ?? '', /by ghost/);
    assert.equal(
      row.querySelector('.ghx-row__checks svg')?.getAttribute('aria-label'),
      'Some checks were not successful',
    );
    assert.equal(row.querySelector('.ghx-row__comments')?.getAttribute('aria-label'), '4 comments');
    assert.equal(row.querySelector('.ghx-label')?.textContent, 'enhancement');
  });

  it('keeps user controlled text inert', () => {
    const row = pullRequestRow(
      pullRequest({
        title: '<script>alert(1)</script>',
        labels: [{ name: '<b>x</b>', color: '000000' }],
      }),
      { now: NOW },
    );

    assert.equal(row.querySelector('script'), null);
    assert.equal(row.querySelector('b'), null);
    assert.equal(row.querySelector('.ghx-row__title')?.textContent, '<script>alert(1)</script>');
  });
});
