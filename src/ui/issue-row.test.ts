import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { Actor, IssueItem } from '../shared/types.ts';
import { issueRow, issueStatus } from './issue-row.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const NOW = '2026-11-26T12:00:00Z';

const actor = (login: string): Actor => ({
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}`,
  url: `https://github.com/${login}`,
});

function issue(overrides: Partial<IssueItem> = {}): IssueItem {
  return {
    id: 'I_1',
    number: 7,
    title: 'Crash on start',
    url: 'https://github.com/octo/repo/issues/7',
    repo: { owner: 'octo', name: 'repo' },
    author: actor('hubot'),
    state: 'open',
    stateReason: null,
    assignees: [],
    labels: [],
    commentCount: 0,
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-25T12:00:00Z',
    ...overrides,
  };
}

describe('issueStatus', () => {
  it('maps open and every close reason', () => {
    assert.deepEqual(issueStatus({ state: 'open', stateReason: 'reopened' }), {
      icon: 'issue-opened',
      tone: 'success',
      label: 'Open issue',
    });
    assert.deepEqual(issueStatus({ state: 'closed', stateReason: 'completed' }), {
      icon: 'issue-closed',
      tone: 'done',
      label: 'Closed as completed',
    });
    assert.equal(issueStatus({ state: 'closed', stateReason: null }).icon, 'issue-closed');
    assert.deepEqual(issueStatus({ state: 'closed', stateReason: 'not_planned' }), {
      icon: 'skip',
      tone: 'muted',
      label: 'Closed as not planned',
    });
    assert.equal(
      issueStatus({ state: 'closed', stateReason: 'duplicate' }).label,
      'Closed as duplicate',
    );
  });
});

describe('issueRow', () => {
  it('renders an open issue', () => {
    const row = issueRow(issue(), { now: NOW });
    const meta = [...row.querySelectorAll('.ghx-row__meta-item')].map((item) => item.textContent);

    assert.ok(row.classList.contains('ghx-row--issue'));
    assert.equal(row.dataset['id'], 'I_1');
    assert.equal(row.querySelector('.ghx-row__repo')?.textContent, 'octo/repo');
    assert.equal(row.querySelector('.ghx-row__title')?.textContent, 'Crash on start');
    assert.deepEqual(meta, ['#7', 'by hubot', 'updated yesterday']);
    assert.equal(row.querySelector('.ghx-row__side'), null);
  });

  it('renders closed state, assignees, comments and labels without repo', () => {
    const row = issueRow(
      issue({
        state: 'closed',
        stateReason: 'not_planned',
        assignees: [actor('a'), actor('b')],
        commentCount: 1,
        labels: [{ name: 'wontfix', color: 'ffffff' }],
      }),
      { now: NOW, showRepo: false },
    );

    assert.equal(row.querySelector('.ghx-row__repo'), null);
    assert.ok(row.querySelector('.ghx-row__icon.ghx-tone--muted .ghx-icon--skip'));
    const avatars = row.querySelector('.ghx-avatars');
    assert.equal(avatars?.getAttribute('aria-label'), 'Assigned to: a, b');
    assert.equal(row.querySelectorAll('.ghx-avatar').length, 2);
    assert.equal(row.querySelector('.ghx-row__comments')?.getAttribute('aria-label'), '1 comment');
    assert.equal(row.querySelector('.ghx-label')?.textContent, 'wontfix');
  });
});
