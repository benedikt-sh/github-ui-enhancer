import type { RepoRef } from './types.ts';

export function repoFullName(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function parseRepoFullName(value: string): RepoRef | null {
  const parts = value.trim().split('/');
  if (parts.length !== 2) {
    return null;
  }
  const [owner, name] = parts as [string, string];
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    return null;
  }
  return { owner, name };
}

/** GitHub logins and repository names are case-insensitive. */
export function sameOwner(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
