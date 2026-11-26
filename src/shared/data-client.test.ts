import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWidgetDataClient } from './data-client.ts';
import type { Operation, RequestSender } from './messages.ts';

function recordingSender() {
  const sent: Array<{ op: Operation; params: unknown }> = [];
  const send = (async (op: Operation, params: unknown) => {
    sent.push({ op, params });
    return { op };
  }) as RequestSender;
  return { sent, client: createWidgetDataClient(send) };
}

describe('createWidgetDataClient', () => {
  const repo = { owner: 'octo', name: 'app' };

  it('maps every method to its operation and passes options', async () => {
    const { sent, client } = recordingSender();

    await client.repoIndex({ forceRefresh: true });
    await client.searchPullRequests('review-requested:@me', { limit: 10 });
    await client.searchIssues('assignee:@me', { limit: 3 });
    await client.subscribedIssues({ limit: 7 });
    await client.workflowRuns(repo, { branch: 'main' });
    await client.branches(repo, { forceRefresh: true });

    assert.deepEqual(sent, [
      { op: 'data.repoIndex', params: { options: { forceRefresh: true } } },
      {
        op: 'data.searchPullRequests',
        params: { query: 'review-requested:@me', options: { limit: 10 } },
      },
      { op: 'data.searchIssues', params: { query: 'assignee:@me', options: { limit: 3 } } },
      { op: 'data.subscribedIssues', params: { options: { limit: 7 } } },
      { op: 'data.workflowRuns', params: { repo, options: { branch: 'main' } } },
      { op: 'data.branches', params: { repo, options: { forceRefresh: true } } },
    ]);
  });

  it('omits the options key when no options are given', async () => {
    const { sent, client } = recordingSender();

    await client.repoIndex();
    await client.searchPullRequests('author:@me');
    await client.searchIssues('x');
    await client.subscribedIssues();
    await client.workflowRuns(repo);
    await client.branches(repo);

    for (const { params } of sent) {
      assert.equal(Object.hasOwn(params as object, 'options'), false);
    }
  });
});
