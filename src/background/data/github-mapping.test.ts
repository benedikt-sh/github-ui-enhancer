import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isRestPullRequest,
  mapAll,
  mapBranch,
  mapIssueNode,
  mapPullRequestNode,
  mapRepo,
  mapRestIssue,
  mapWorkflowRun,
} from './github-mapping.ts';
import {
  graphQLActor,
  graphQLIssue,
  graphQLPullRequest,
  restBranch,
  restIssue,
  restPullRequestIssue,
  restRepo,
  restWorkflowRun,
} from './github-responses.fixture.ts';
import {
  isBranchItem,
  isIssueItem,
  isPullRequestItem,
  isRepoSummary,
  isWorkflowRunItem,
} from './values.ts';

describe('mapRepo', () => {
  it('keeps only the summary fields', () => {
    const repo = mapRepo(restRepo());

    assert.deepEqual(repo, {
      id: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
      owner: 'octocat',
      name: 'Hello-World',
      fullName: 'octocat/Hello-World',
      description: 'This your first repo!',
      visibility: 'public',
      archived: false,
      fork: false,
      defaultBranch: 'main',
      pushedAt: '2026-11-20T10:00:00Z',
      url: 'https://github.com/octocat/Hello-World',
    });
    assert.ok(isRepoSummary(repo));
  });

  it('falls back to the private flag and defaults for missing optional fields', () => {
    const repo = mapRepo(
      restRepo({
        visibility: undefined,
        private: true,
        description: null,
        archived: true,
        fork: true,
        default_branch: undefined,
        pushed_at: null,
      }),
    );

    assert.equal(repo?.visibility, 'private');
    assert.equal(repo?.description, null);
    assert.equal(repo?.archived, true);
    assert.equal(repo?.fork, true);
    assert.equal(repo?.defaultBranch, '');
    assert.equal(repo?.pushedAt, null);
    assert.ok(isRepoSummary(repo));
    assert.equal(mapRepo(restRepo({ visibility: 'weird' }))?.visibility, 'public');
    assert.equal(mapRepo(restRepo({ visibility: 'internal' }))?.visibility, 'internal');
  });

  it('rejects entries without required fields', () => {
    assert.equal(mapRepo(restRepo({ node_id: '' })), null);
    assert.equal(mapRepo(restRepo({ owner: null })), null);
    assert.equal(mapRepo(restRepo({ name: 1 })), null);
    assert.equal(mapRepo(restRepo({ full_name: undefined })), null);
    assert.equal(mapRepo(restRepo({ html_url: null })), null);
    assert.equal(mapRepo('nope'), null);
  });
});

describe('mapPullRequestNode', () => {
  it('maps review, check and label information', () => {
    const item = mapPullRequestNode(graphQLPullRequest());

    assert.deepEqual(item, {
      id: 'PR_kwDOAAABBB5abc',
      number: 42,
      title: 'Add dark mode',
      url: 'https://github.com/acme/web/pull/42',
      repo: { owner: 'acme', name: 'web' },
      createdAt: '2026-11-20T08:00:00Z',
      updatedAt: '2026-11-25T08:00:00Z',
      author: graphQLActor('octocat'),
      state: 'open',
      isDraft: false,
      reviewDecision: 'review_required',
      checkState: 'success',
      labels: [{ name: 'enhancement', color: 'a2eeef' }],
      commentCount: 5,
    });
    assert.ok(isPullRequestItem(item));
  });

  it('handles drafts, merged state, missing rollups and ghost authors', () => {
    const item = mapPullRequestNode(
      graphQLPullRequest({
        state: 'MERGED',
        isDraft: true,
        reviewDecision: null,
        author: null,
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        labels: { nodes: [{ name: 'x' }, { name: '' }, null] },
        comments: null,
      }),
    );

    assert.equal(item?.state, 'merged');
    assert.equal(item?.isDraft, true);
    assert.equal(item?.reviewDecision, null);
    assert.equal(item?.checkState, null);
    assert.equal(item?.author, null);
    assert.deepEqual(item?.labels, [{ name: 'x', color: '' }]);
    assert.equal(item?.commentCount, 0);
    assert.ok(isPullRequestItem(item));
  });

  it('fills missing actor links and tolerates unknown enum values', () => {
    const item = mapPullRequestNode(
      graphQLPullRequest({
        author: { login: 'ghost' },
        reviewDecision: 'SOMETHING_NEW',
        commits: { nodes: [] },
        labels: null,
      }),
    );

    assert.deepEqual(item?.author, {
      login: 'ghost',
      avatarUrl: '',
      url: 'https://github.com/ghost',
    });
    assert.equal(item?.reviewDecision, null);
    assert.equal(item?.checkState, null);
    assert.deepEqual(item?.labels, []);
  });

  it('rejects other node types and incomplete nodes', () => {
    assert.equal(mapPullRequestNode(graphQLIssue()), null);
    assert.equal(mapPullRequestNode({}), null);
    assert.equal(mapPullRequestNode(null), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ state: 'DRAFTY' })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ number: 1.5 })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ repository: null })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ id: '' })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ title: null })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ url: null })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ createdAt: null })), null);
    assert.equal(mapPullRequestNode(graphQLPullRequest({ updatedAt: null })), null);
  });
});

describe('mapIssueNode', () => {
  it('maps state reason and assignees', () => {
    const item = mapIssueNode(graphQLIssue());

    assert.deepEqual(item, {
      id: 'I_kwDOAAABBB5xyz',
      number: 7,
      title: 'Crash on start',
      url: 'https://github.com/acme/web/issues/7',
      repo: { owner: 'acme', name: 'web' },
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-24T08:00:00Z',
      author: graphQLActor('hubot'),
      state: 'closed',
      stateReason: 'not_planned',
      assignees: [graphQLActor('octocat')],
      labels: [{ name: 'bug', color: 'd73a4a' }],
      commentCount: 1,
    });
    assert.ok(isIssueItem(item));
  });

  it('drops broken assignees and unknown state reasons', () => {
    const item = mapIssueNode(
      graphQLIssue({
        state: 'OPEN',
        stateReason: null,
        assignees: { nodes: [null, { login: '' }, graphQLActor('a')] },
      }),
    );

    assert.equal(item?.stateReason, null);
    assert.deepEqual(item?.assignees, [graphQLActor('a')]);
    assert.equal(mapIssueNode(graphQLIssue({ stateReason: 'NEW_REASON' }))?.stateReason, null);
  });

  it('rejects other node types and unknown states', () => {
    assert.equal(mapIssueNode(graphQLPullRequest()), null);
    assert.equal(mapIssueNode(graphQLIssue({ state: 'MERGED' })), null);
    assert.equal(mapIssueNode(graphQLIssue({ repository: { name: 'x', owner: null } })), null);
  });
});

describe('mapRestIssue', () => {
  it('maps an entry of GET /issues', () => {
    const item = mapRestIssue(restIssue());

    assert.deepEqual(item, {
      id: 'I_kwDOABCD1M5abcde',
      number: 1347,
      title: 'Found a bug',
      url: 'https://github.com/octocat/Hello-World/issues/1347',
      repo: { owner: 'octocat', name: 'Hello-World' },
      author: {
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
        url: 'https://github.com/octocat',
      },
      state: 'open',
      stateReason: null,
      assignees: [
        {
          login: 'hubot',
          avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
          url: 'https://github.com/hubot',
        },
      ],
      labels: [{ name: 'bug', color: 'f29513' }],
      commentCount: 3,
      createdAt: '2026-11-01T09:00:00Z',
      updatedAt: '2026-11-22T12:00:00Z',
    });
    assert.ok(isIssueItem(item));
  });

  it('derives the repository from repository_url when the object is missing', () => {
    const item = mapRestIssue(
      restIssue({ repository: undefined, state: 'closed', state_reason: 'completed' }),
    );

    assert.deepEqual(item?.repo, { owner: 'octocat', name: 'Hello-World' });
    assert.equal(item?.stateReason, 'completed');
  });

  it('defaults missing lists, users and counts', () => {
    const item = mapRestIssue(
      restIssue({ user: null, assignees: null, labels: undefined, comments: '3' }),
    );

    assert.equal(item?.author, null);
    assert.deepEqual(item?.assignees, []);
    assert.deepEqual(item?.labels, []);
    assert.equal(item?.commentCount, 0);
    assert.ok(isIssueItem(item));
  });

  it('skips pull requests and broken entries', () => {
    assert.equal(isRestPullRequest(restPullRequestIssue(5)), true);
    assert.equal(isRestPullRequest(restIssue({ pull_request: null })), false);
    assert.equal(isRestPullRequest('x'), false);
    assert.equal(mapRestIssue(restPullRequestIssue(5)), null);
    assert.equal(mapRestIssue(restIssue({ repository: undefined, repository_url: 'x' })), null);
    assert.equal(mapRestIssue(restIssue({ repository: undefined, repository_url: null })), null);
    assert.equal(mapRestIssue(restIssue({ state: 'merged' })), null);
    assert.equal(mapRestIssue(restIssue({ node_id: null })), null);
    assert.equal(mapRestIssue(restIssue({ number: '1' })), null);
    assert.equal(mapRestIssue(restIssue({ title: 1 })), null);
    assert.equal(mapRestIssue(restIssue({ html_url: null })), null);
    assert.equal(mapRestIssue(restIssue({ created_at: null })), null);
    assert.equal(mapRestIssue(restIssue({ updated_at: null })), null);
  });
});

describe('mapWorkflowRun', () => {
  it('maps a run', () => {
    const run = mapWorkflowRun(restWorkflowRun());

    assert.deepEqual(run, {
      id: 30433642,
      workflowName: 'Build',
      displayTitle: 'Update README.md',
      runNumber: 562,
      runAttempt: 1,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      branch: 'main',
      headSha: 'acb5820ced9479c074f688cc328bf03f341a511d',
      actor: {
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
        url: 'https://github.com/octocat',
      },
      url: 'https://github.com/octo-org/octo-repo/actions/runs/30433642',
      createdAt: '2026-11-25T10:00:00Z',
      updatedAt: '2026-11-25T10:05:00Z',
      runStartedAt: '2026-11-25T10:00:05Z',
    });
    assert.ok(isWorkflowRunItem(run));
  });

  it('uses defaults for optional fields and unknown states', () => {
    const run = mapWorkflowRun(
      restWorkflowRun({
        name: null,
        display_title: undefined,
        run_number: undefined,
        run_attempt: undefined,
        event: undefined,
        status: 'brand_new',
        conclusion: null,
        head_branch: null,
        actor: null,
        run_started_at: undefined,
      }),
    );

    assert.equal(run?.workflowName, '');
    assert.equal(run?.displayTitle, '');
    assert.equal(run?.runNumber, 0);
    assert.equal(run?.runAttempt, 1);
    assert.equal(run?.event, '');
    assert.equal(run?.status, 'pending');
    assert.equal(run?.conclusion, null);
    assert.equal(run?.branch, null);
    assert.equal(run?.actor?.login, 'hubot');
    assert.equal(run?.runStartedAt, null);
    assert.ok(isWorkflowRunItem(run));
    assert.equal(
      mapWorkflowRun(restWorkflowRun({ actor: null, triggering_actor: null }))?.actor,
      null,
    );
  });

  it('rejects runs without required fields', () => {
    assert.equal(mapWorkflowRun(restWorkflowRun({ id: '1' })), null);
    assert.equal(mapWorkflowRun(restWorkflowRun({ html_url: null })), null);
    assert.equal(mapWorkflowRun(restWorkflowRun({ head_sha: null })), null);
    assert.equal(mapWorkflowRun(restWorkflowRun({ created_at: null })), null);
    assert.equal(mapWorkflowRun(restWorkflowRun({ updated_at: null })), null);
  });
});

describe('mapBranch and mapAll', () => {
  it('maps branches and skips broken entries', () => {
    const branches = mapAll([restBranch('main', true), restBranch('dev'), { name: '' }], mapBranch);

    assert.deepEqual(branches, [
      { name: 'main', protected: true },
      { name: 'dev', protected: false },
    ]);
    assert.ok(branches.every(isBranchItem));
  });

  it('treats anything but a list as empty', () => {
    assert.deepEqual(mapAll({ items: [] }, mapBranch), []);
  });
});
