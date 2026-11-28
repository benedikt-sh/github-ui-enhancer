import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRepoSearcher } from '../../lib/fuzzy.ts';
import type { ApiErrorInfo } from '../../shared/errors.ts';
import type { RecentRepoItem, RepoSummary } from '../../shared/types.ts';
import { NOW, recentItem, repo, REPOS } from './quick-switcher.fixture.ts';
import type { RepoStoreSnapshot } from './repo-store.ts';
import { buildResults, MAX_RESULTS, withPages } from './results.ts';

function snapshot(
  repos: readonly RepoSummary[] | null,
  overrides: Partial<RepoStoreSnapshot> & { errors?: readonly ApiErrorInfo[] } = {},
): RepoStoreSnapshot {
  const { errors = [], ...rest } = overrides;
  return {
    index:
      repos === null
        ? null
        : {
            repos,
            searcher: createRepoSearcher(repos, { now: () => NOW }),
            errors,
            fetchedAt: '2026-11-26T12:00:00.000Z',
          },
    loadError: null,
    loading: false,
    recent: [],
    ...rest,
  };
}

function names(snap: RepoStoreSnapshot, query: string): string[] {
  return buildResults(snap, query).entries.map((entry) => entry.fullName);
}

const TOKEN_ERROR: ApiErrorInfo = { kind: 'unauthorized', message: 'bad', owner: 'globex' };

describe('buildResults', () => {
  it('lists the most recently pushed repositories without archived ones for no query', () => {
    assert.deepEqual(names(snapshot(REPOS), ''), [
      'acme/billing-api',
      'acme/web',
      'globex/billing-ui',
      'octo/forked',
    ]);
    assert.deepEqual(names(snapshot(REPOS), '   '), names(snapshot(REPOS), ''));
  });

  it('puts recent repositories first and does not repeat them', () => {
    const snap = snapshot(REPOS, {
      recent: [recentItem('ACME/Web'), recentItem('globex/billing-ui')],
    });
    const { entries } = buildResults(snap, '');
    assert.deepEqual(
      entries.map((entry) => [entry.fullName, entry.recent]),
      [
        ['acme/web', true],
        ['globex/billing-ui', true],
        ['acme/billing-api', false],
        ['octo/forked', false],
      ],
    );
    assert.equal(entries[1]?.visibility, 'internal');
  });

  it('keeps recent repositories the index does not know', () => {
    const snap = snapshot(REPOS, {
      recent: [recentItem('other/thing'), recentItem('evil/link', 'javascript:alert(1)')],
    });
    const [first, second] = buildResults(snap, '').entries;
    assert.deepEqual(first, {
      kind: 'repo',
      key: 'other/thing',
      fullName: 'other/thing',
      url: 'https://github.com/other/thing',
      description: null,
      visibility: null,
      archived: false,
      fork: false,
      nameHighlights: [],
      descriptionHighlights: [],
      recent: true,
    });
    assert.equal(second?.url, 'https://github.com/evil/link');
  });

  it('caps the start list at the result limit', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      repo(`acme/repo-${i}`, { pushedAt: new Date(NOW - i * 60_000).toISOString() }),
    );
    const recent: RecentRepoItem[] = Array.from({ length: 12 }, (_, i) =>
      recentItem(`other/recent-${i}`),
    );
    assert.equal(buildResults(snapshot(many), '').entries.length, MAX_RESULTS);
    const withRecent = buildResults(snapshot(many, { recent }), '').entries;
    assert.equal(withRecent.length, MAX_RESULTS);
    assert.ok(withRecent.every((entry) => entry.recent));
  });

  it('searches with highlights and includes archived repositories', () => {
    const { entries, state } = buildResults(snapshot(REPOS), 'billing');
    assert.equal(state, null);
    assert.deepEqual(
      entries.map((entry) => entry.fullName),
      ['acme/billing-api', 'globex/billing-ui', 'acme/old-billing'],
    );
    assert.deepEqual(entries[0]?.nameHighlights, [[5, 12]]);
    assert.equal(entries[2]?.archived, true);
    assert.equal(entries[0]?.recent, false);
  });

  it('highlights description matches', () => {
    const [entry] = buildResults(snapshot(REPOS), 'invoices').entries;
    assert.equal(entry?.fullName, 'acme/billing-api');
    assert.deepEqual(entry?.descriptionHighlights, [[8, 16]]);
  });

  it('limits search results', () => {
    const many = Array.from({ length: 30 }, (_, i) => repo(`acme/repo-${i}`));
    assert.equal(buildResults(snapshot(many), 'repo').entries.length, MAX_RESULTS);
  });

  it('falls back to a GitHub URL for unsafe repository URLs', () => {
    const snap = snapshot([repo('acme/web', { url: 'javascript:alert(1)' })]);
    assert.equal(buildResults(snap, 'web').entries[0]?.url, 'https://github.com/acme/web');
  });

  it('reports no match for a query without results', () => {
    assert.deepEqual(buildResults(snapshot(REPOS), ' nothing-here '), {
      entries: [],
      state: { kind: 'no-match', query: 'nothing-here' },
      partialErrors: [],
    });
  });

  it('reports no match for an empty query when every repository is archived', () => {
    const snap = snapshot([repo('acme/old', { archived: true })]);
    assert.deepEqual(buildResults(snap, '').state, { kind: 'no-match', query: '' });
  });

  it('passes partial errors along with the results', () => {
    const results = buildResults(snapshot(REPOS, { errors: [TOKEN_ERROR] }), 'web');
    assert.equal(results.entries.length, 1);
    assert.deepEqual(results.partialErrors, [TOKEN_ERROR]);
  });

  it('shows the loading state with recent repositories while the index loads', () => {
    const snap = snapshot(null, { loading: true, recent: [recentItem('acme/web')] });
    const results = buildResults(snap, '');
    assert.deepEqual(results.state, { kind: 'loading' });
    assert.deepEqual(
      results.entries.map((entry) => [entry.fullName, entry.visibility]),
      [['acme/web', null]],
    );
    assert.deepEqual(buildResults(snap, 'web').entries, []);
  });

  it('shows a failed first load as error', () => {
    const error: ApiErrorInfo = { kind: 'network', message: 'offline' };
    const snap = snapshot(null, { loadError: error, recent: [recentItem('acme/web')] });
    assert.deepEqual(buildResults(snap, ''), {
      entries: [],
      state: { kind: 'error', errors: [error] },
      partialErrors: [],
    });
  });

  it('shows the loading state again while a failed load is retried', () => {
    const error: ApiErrorInfo = { kind: 'network', message: 'offline' };
    const snap = snapshot(null, { loadError: error, loading: true });
    assert.deepEqual(buildResults(snap, '').state, { kind: 'loading' });
  });

  it('shows the missing token state', () => {
    const loadError: ApiErrorInfo = { kind: 'no_tokens', message: 'none' };
    assert.deepEqual(buildResults(snapshot(null, { loadError }), '').state, {
      kind: 'no-tokens',
    });
    const empty = snapshot([], { errors: [loadError] });
    assert.deepEqual(buildResults(empty, 'x').state, { kind: 'no-tokens' });
  });

  it('shows errors when no repository loaded at all', () => {
    const results = buildResults(snapshot([], { errors: [TOKEN_ERROR] }), '');
    assert.deepEqual(results.state, { kind: 'error', errors: [TOKEN_ERROR] });
  });

  it('shows an empty state when the tokens grant no repositories', () => {
    assert.deepEqual(buildResults(snapshot([]), '').state, { kind: 'no-repos' });
  });
});

describe('withPages', () => {
  const base = buildResults(snapshot(REPOS), '');

  it('puts the dashboard first for an empty query and caps the list', () => {
    const results = withPages(base, '  ');
    assert.equal(results.entries[0]?.fullName, 'Dashboard');
    assert.equal(results.entries[0]?.kind, 'page');
    assert.equal(results.entries[0]?.url, 'https://github.com/');
    assert.ok(results.entries.length <= MAX_RESULTS);
  });

  it('finds the dashboard by the start of its terms and highlights its title', () => {
    const typed = withPages(buildResults(snapshot(REPOS), 'Dash'), 'Dash');
    assert.equal(typed.entries[0]?.fullName, 'Dashboard');
    assert.deepEqual(typed.entries[0]?.nameHighlights, [[0, 4]]);
    assert.equal(typed.state, null);

    const home = withPages(buildResults(snapshot(REPOS), 'home'), 'home');
    assert.equal(home.entries[0]?.fullName, 'Dashboard');
    assert.deepEqual(home.entries[0]?.nameHighlights, []);
  });

  it('leaves other queries and loading states alone', () => {
    const other = buildResults(snapshot(REPOS), 'web');
    assert.equal(withPages(other, 'web'), other);

    const loading = withPages(buildResults(snapshot(null), ''), '');
    assert.equal(loading.entries[0]?.fullName, 'Dashboard');
    assert.equal(loading.state?.kind, 'loading');
  });
});

