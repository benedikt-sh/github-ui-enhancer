import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateRecentRepos, isRecentEvent, mapEvent } from './recent-repos.ts';
import type { RecentEvent } from './recent-repos.ts';

function restEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1',
    type: 'PushEvent',
    created_at: '2026-11-27T10:00:00Z',
    repo: { id: 1, name: 'acme/api', url: 'https://api.github.com/repos/acme/api' },
    payload: { ref: 'refs/heads/main' },
    ...overrides,
  };
}

function event(id: string, repo: string, kind: RecentEvent['kind'], at: string): RecentEvent {
  const [owner = '', name = ''] = repo.split('/');
  return { id, repo: { owner, name }, kind, branch: null, createdAt: at };
}

describe('mapEvent', () => {
  it('maps a push with its branch', () => {
    assert.deepEqual(mapEvent(restEvent()), {
      id: '1',
      repo: { owner: 'acme', name: 'api' },
      kind: 'push',
      branch: 'main',
      createdAt: '2026-11-27T10:00:00Z',
    });
  });

  it('maps known event types and keeps unknown ones as other', () => {
    const kinds = [
      'PullRequestEvent',
      'PullRequestReviewEvent',
      'PullRequestReviewCommentEvent',
      'PullRequestReviewThreadEvent',
      'IssuesEvent',
      'IssueCommentEvent',
      'CommitCommentEvent',
      'ReleaseEvent',
      'WatchEvent',
      42,
    ].map((type) => mapEvent(restEvent({ type, payload: {} }))?.kind);

    assert.deepEqual(kinds, [
      'pull_request',
      'review',
      'review',
      'review',
      'issue',
      'comment',
      'comment',
      'release',
      'other',
      'other',
    ]);
  });

  it('takes the branch of created branches only', () => {
    const create = (payload: unknown) => mapEvent(restEvent({ type: 'CreateEvent', payload }));
    const branch = create({ ref_type: 'branch', ref: 'feat' });
    const tag = create({ ref_type: 'tag', ref: 'v1' });
    const tagPush = mapEvent(restEvent({ payload: { ref: 'refs/tags/v1' } }));
    const noPayload = mapEvent(restEvent({ payload: null }));

    assert.equal(branch?.branch, 'feat');
    assert.equal(tag?.branch, null);
    assert.equal(tagPush?.branch, null);
    assert.equal(noPayload?.branch, null);
  });

  it('drops entries without id, time or a valid repository', () => {
    for (const value of [
      null,
      restEvent({ id: '' }),
      restEvent({ created_at: 1 }),
      restEvent({ repo: { name: 'not a repo' } }),
      restEvent({ repo: null }),
    ]) {
      assert.equal(mapEvent(value), null);
    }
  });
});

describe('isRecentEvent', () => {
  it('accepts mapped events and rejects broken ones', () => {
    const mapped = mapEvent(restEvent());
    assert.equal(isRecentEvent(mapped), true);
    assert.equal(isRecentEvent({ ...mapped, kind: 'party' }), false);
    assert.equal(isRecentEvent({ ...mapped, branch: 1 }), false);
    assert.equal(isRecentEvent('event'), false);
  });
});

describe('aggregateRecentRepos', () => {
  const events = [
    { ...event('5', 'acme/api', 'push', '2026-11-27T10:00:00Z'), branch: 'main' },
    event('4', 'Acme/API', 'comment', '2026-11-27T09:00:00Z'),
    event('3', 'octo/web', 'pull_request', '2026-11-26T10:00:00Z'),
    event('2', 'octo/docs', 'comment', '2026-11-25T10:00:00Z'),
    event('1', 'acme/api', 'push', '2026-11-24T10:00:00Z'),
  ];

  it('groups by repository with the newest activity first', () => {
    assert.deepEqual(aggregateRecentRepos(events, undefined, 10), [
      {
        repo: { owner: 'acme', name: 'api' },
        url: 'https://github.com/acme/api',
        lastActivityAt: '2026-11-27T10:00:00Z',
        lastActivity: 'push',
        branch: 'main',
        activityCount: 3,
      },
      {
        repo: { owner: 'octo', name: 'web' },
        url: 'https://github.com/octo/web',
        lastActivityAt: '2026-11-26T10:00:00Z',
        lastActivity: 'pull_request',
        branch: null,
        activityCount: 1,
      },
      {
        repo: { owner: 'octo', name: 'docs' },
        url: 'https://github.com/octo/docs',
        lastActivityAt: '2026-11-25T10:00:00Z',
        lastActivity: 'comment',
        branch: null,
        activityCount: 1,
      },
    ]);
  });

  it('counts only the requested kinds and applies the limit', () => {
    const result = aggregateRecentRepos(events, ['push', 'pull_request'], 1);

    assert.deepEqual(
      result.map((item) => [item.repo.name, item.activityCount]),
      [['api', 2]],
    );
  });
});
