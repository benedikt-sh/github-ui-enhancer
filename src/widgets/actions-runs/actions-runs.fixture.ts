import type { RepoSummary, WorkflowRunItem } from '../../shared/types.ts';

export const NOW = Date.parse('2026-11-26T12:00:00Z');

export function repoSummary(fullName: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id: `R_${fullName}`,
    owner,
    name,
    fullName,
    description: null,
    visibility: 'public',
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: '2026-11-20T00:00:00Z',
    url: `https://github.com/${fullName}`,
    ...overrides,
  };
}

export function workflowRun(id: number, overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id,
    workflowName: 'CI',
    displayTitle: `Run ${id}`,
    runNumber: id,
    runAttempt: 1,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    branch: 'main',
    headSha: 'abc',
    actor: null,
    url: `https://github.com/octo/repo/actions/runs/${id}`,
    createdAt: '2026-11-26T11:00:00Z',
    updatedAt: '2026-11-26T11:05:00Z',
    runStartedAt: '2026-11-26T11:00:00Z',
    ...overrides,
  };
}

/** Lets pending promise callbacks run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
