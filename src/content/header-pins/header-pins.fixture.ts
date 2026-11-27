import type { RepoSummary } from '../../shared/types.ts';

export const NOW = Date.parse('2026-11-26T00:00:00Z');

export function summary(
  owner: string,
  name: string,
  pushedAt = '2026-11-20T00:00:00Z',
): RepoSummary {
  return {
    id: `${owner}/${name}`,
    owner,
    name,
    fullName: `${owner}/${name}`,
    description: null,
    visibility: 'public',
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt,
    url: `https://github.com/${owner}/${name}`,
  };
}

/** Global bar as on github.com: start part with logo and context, end part with search. */
export const GLOBAL_BAR = `
  <div class="position-relative header-wrapper js-header-wrapper">
    <header class="AppHeader" role="banner">
      <div class="AppHeader-globalBar">
        <div class="AppHeader-globalBar-start"><a class="AppHeader-logo" href="/">GitHub</a></div>
        <div class="AppHeader-globalBar-end">
          <div class="AppHeader-search" id="search"></div>
          <div class="AppHeader-actions"></div>
        </div>
      </div>
    </header>
  </div>
  <main>Content</main>`;

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
