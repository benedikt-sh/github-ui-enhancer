import type { RepoSummary } from '../../shared/types.ts';

export function repo(fullName: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
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
    pushedAt: '2026-11-20T12:00:00.000Z',
    url: `https://github.com/${fullName}`,
    ...overrides,
  };
}
