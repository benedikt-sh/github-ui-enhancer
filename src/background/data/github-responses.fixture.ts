/*
 * Trimmed but realistic GitHub API responses, following the shapes documented for REST API
 * version 2026-03-10 and the GraphQL schema. Irrelevant fields are partly kept on purpose to
 * show that the mapping drops them.
 */

export function restRepo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1296269,
    node_id: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
    name: 'Hello-World',
    full_name: 'octocat/Hello-World',
    private: false,
    owner: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://github.com/images/error/octocat_happy.gif',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    html_url: 'https://github.com/octocat/Hello-World',
    description: 'This your first repo!',
    fork: false,
    url: 'https://api.github.com/repos/octocat/Hello-World',
    default_branch: 'main',
    visibility: 'public',
    archived: false,
    disabled: false,
    pushed_at: '2026-11-20T10:00:00Z',
    created_at: '2011-01-26T19:01:12Z',
    updated_at: '2026-11-20T10:00:00Z',
    stargazers_count: 80,
    permissions: { admin: false, push: false, pull: true },
    ...overrides,
  };
}

export function restUser(login: string): Record<string, unknown> {
  return {
    login,
    id: 42,
    node_id: 'MDQ6VXNlcjQy',
    avatar_url: `https://avatars.githubusercontent.com/u/42?v=4`,
    html_url: `https://github.com/${login}`,
    type: 'User',
    site_admin: false,
  };
}

export function restIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    node_id: 'I_kwDOABCD1M5abcde',
    url: 'https://api.github.com/repos/octocat/Hello-World/issues/1347',
    repository_url: 'https://api.github.com/repos/octocat/Hello-World',
    html_url: 'https://github.com/octocat/Hello-World/issues/1347',
    number: 1347,
    state: 'open',
    state_reason: null,
    title: 'Found a bug',
    body: 'I am having a problem with this.',
    user: restUser('octocat'),
    labels: [
      {
        id: 208045946,
        node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
        name: 'bug',
        description: "Something isn't working",
        color: 'f29513',
        default: true,
      },
    ],
    assignee: restUser('hubot'),
    assignees: [restUser('hubot')],
    locked: false,
    comments: 3,
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-22T12:00:00Z',
    closed_at: null,
    repository: restRepo(),
    ...overrides,
  };
}

export function restPullRequestIssue(number: number): Record<string, unknown> {
  return restIssue({
    node_id: `PR_kwDOABCD${number}`,
    number,
    html_url: `https://github.com/octocat/Hello-World/pull/${number}`,
    pull_request: {
      url: `https://api.github.com/repos/octocat/Hello-World/pulls/${number}`,
      html_url: `https://github.com/octocat/Hello-World/pull/${number}`,
      merged_at: null,
    },
  });
}

export function restWorkflowRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 30433642,
    name: 'Build',
    node_id: 'MDEyOldvcmtmbG93IFJ1bjI2OTI4OQ==',
    check_suite_id: 42,
    head_branch: 'main',
    head_sha: 'acb5820ced9479c074f688cc328bf03f341a511d',
    path: '.github/workflows/build.yml@main',
    display_title: 'Update README.md',
    run_number: 562,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    workflow_id: 159038,
    url: 'https://api.github.com/repos/octo-org/octo-repo/actions/runs/30433642',
    html_url: 'https://github.com/octo-org/octo-repo/actions/runs/30433642',
    pull_requests: [],
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:05:00Z',
    actor: restUser('octocat'),
    triggering_actor: restUser('hubot'),
    run_attempt: 1,
    run_started_at: '2026-11-25T10:00:05Z',
    head_commit: { id: 'acb5820ced9479c074f688cc328bf03f341a511d', message: 'Update README.md' },
    ...overrides,
  };
}

export function restBranch(name: string, isProtected = false): Record<string, unknown> {
  return {
    name,
    commit: {
      sha: 'c5b97d5ae6c19d5c5df71a34c7fbeeda2479ccbc',
      url: 'https://api.github.com/repos/octocat/Hello-World/commits/c5b97d5',
    },
    protected: isProtected,
  };
}

export function graphQLActor(login: string): Record<string, unknown> {
  return {
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/9?u=${login}&v=4`,
    url: `https://github.com/${login}`,
  };
}

export function graphQLPullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __typename: 'PullRequest',
    id: 'PR_kwDOAAABBB5abc',
    number: 42,
    title: 'Add dark mode',
    url: 'https://github.com/acme/web/pull/42',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    createdAt: '2026-11-20T08:00:00Z',
    updatedAt: '2026-11-25T08:00:00Z',
    repository: { name: 'web', owner: { login: 'acme' } },
    author: graphQLActor('octocat'),
    labels: { nodes: [{ name: 'enhancement', color: 'a2eeef' }] },
    comments: { totalCount: 5 },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...overrides,
  };
}

export function graphQLIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __typename: 'Issue',
    id: 'I_kwDOAAABBB5xyz',
    number: 7,
    title: 'Crash on start',
    url: 'https://github.com/acme/web/issues/7',
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    createdAt: '2026-11-10T08:00:00Z',
    updatedAt: '2026-11-24T08:00:00Z',
    repository: { name: 'web', owner: { login: 'acme' } },
    author: graphQLActor('hubot'),
    assignees: { nodes: [graphQLActor('octocat')] },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    comments: { totalCount: 1 },
    ...overrides,
  };
}

export function graphQLSearch(nodes: readonly unknown[]): Record<string, unknown> {
  return { issueCount: nodes.length, nodes };
}
