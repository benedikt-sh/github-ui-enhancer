import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isRecord } from '../../shared/guards.ts';
import {
  mapIssueNode,
  mapPullRequestNode,
  mapRepo,
  mapWorkflowRun,
} from './github-mapping.ts';
import {
  graphQLIssue,
  graphQLPullRequest,
  restRepo,
  restWorkflowRun,
} from './github-responses.fixture.ts';
import {
  isArrayOf,
  isBranchItem,
  isCachedListOf,
  isIssueItem,
  isPullRequestItem,
  isRepoSummary,
  isWorkflowRunItem,
} from './values.ts';

function without(value: unknown, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = isRecord(value) ? { ...value } : {};
  delete copy[key];
  return copy;
}

describe('cached value guards', () => {
  const repo = mapRepo(restRepo());
  const pullRequest = mapPullRequestNode(graphQLPullRequest());
  const issue = mapIssueNode(graphQLIssue());
  const run = mapWorkflowRun(restWorkflowRun());

  it('accept mapped values', () => {
    assert.ok(isRepoSummary(repo));
    assert.ok(isPullRequestItem(pullRequest));
    assert.ok(isIssueItem(issue));
    assert.ok(isWorkflowRunItem(run));
    assert.ok(isBranchItem({ name: 'main', protected: false }));
  });

  it('reject values missing a field, e.g. from an older extension version', () => {
    for (const key of Object.keys(repo ?? {})) {
      assert.equal(isRepoSummary(without(repo, key)), false, key);
    }
    for (const key of Object.keys(pullRequest ?? {})) {
      assert.equal(isPullRequestItem(without(pullRequest, key)), false, key);
    }
    for (const key of Object.keys(issue ?? {})) {
      assert.equal(isIssueItem(without(issue, key)), false, key);
    }
    for (const key of Object.keys(run ?? {})) {
      assert.equal(isWorkflowRunItem(without(run, key)), false, key);
    }
    assert.equal(isBranchItem({ name: 'main' }), false);
    assert.equal(isBranchItem(null), false);
    assert.equal(isPullRequestItem(null), false);
  });

  it('accept nullable fields as null', () => {
    assert.ok(isPullRequestItem({ ...pullRequest, author: null, checkState: null }));
    assert.ok(isWorkflowRunItem({ ...run, actor: null, conclusion: null, branch: null }));
    assert.equal(isPullRequestItem({ ...pullRequest, author: { login: 'x' } }), false);
  });

  it('check lists and capped lists', () => {
    assert.ok(isArrayOf(isBranchItem)([]));
    assert.equal(isArrayOf(isBranchItem)({}), false);
    assert.equal(isArrayOf(isBranchItem)([{}]), false);
    const isCached = isCachedListOf(isRepoSummary);
    assert.ok(isCached({ items: [repo], errors: [{ kind: 'internal', message: 'x' }] }));
    assert.equal(isCached({ items: [repo] }), false);
    assert.equal(isCached({ items: [{}], errors: [] }), false);
    assert.equal(isCached({ items: [], errors: [{ kind: 'odd' }] }), false);
    assert.equal(isCached([]), false);
  });
});
