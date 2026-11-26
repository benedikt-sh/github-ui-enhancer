import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RepoSummary } from '../shared/types.ts';
import { createRepoSearcher, DEFAULT_SEARCH_LIMIT, type RepoSearchResult } from './fuzzy.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function repo(fullName: string, extra: Partial<RepoSummary> = {}): RepoSummary {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id: `R_${fullName}`,
    owner,
    name,
    fullName,
    description: null,
    visibility: 'private',
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: daysAgo(200),
    url: `https://github.com/${fullName}`,
    ...extra,
  };
}

function searcher(repos: readonly RepoSummary[]) {
  return createRepoSearcher(repos, { now: () => NOW });
}

function names(results: readonly RepoSearchResult[]): string[] {
  return results.map((result) => result.repo.fullName);
}

function find(results: readonly RepoSearchResult[], fullName: string): RepoSearchResult {
  const result = results.find((candidate) => candidate.repo.fullName === fullName);
  assert.ok(result, `${fullName} not in results`);
  return result;
}

describe('createRepoSearcher ranking', () => {
  it('orders the kinds of name matches from exact to description', () => {
    const repos = [
      repo('initech/ledger', { description: 'Internal API for bookkeeping' }),
      repo('globex/apple-pie'),
      repo('api-team/infra'),
      repo('acme/rapid-deploy'),
      repo('acme/billing-api'),
      repo('acme/api-gateway'),
      repo('acme/api'),
      repo('acme/unrelated'),
    ];
    assert.deepEqual(names(searcher(repos).search('api')), [
      'acme/api',
      'acme/api-gateway',
      'acme/billing-api',
      'acme/rapid-deploy',
      'api-team/infra',
      'globex/apple-pie',
      'initech/ledger',
    ]);
  });

  it('keeps an old exact match above a freshly pushed prefix match', () => {
    const repos = [
      repo('acme/web-site', { pushedAt: daysAgo(0) }),
      repo('acme/web', { pushedAt: daysAgo(1500) }),
    ];
    assert.deepEqual(names(searcher(repos).search('web')), ['acme/web', 'acme/web-site']);
  });

  it('lets recency decide between near equal matches of the same kind', () => {
    const repos = [
      repo('acme/web-app', { pushedAt: daysAgo(365) }),
      repo('acme/web-site', { pushedAt: daysAgo(1) }),
    ];
    assert.deepEqual(names(searcher(repos).search('web')), ['acme/web-site', 'acme/web-app']);
  });

  it('prefers names the term covers more completely', () => {
    const repos = [repo('acme/payments-legacy-adapter'), repo('acme/payments')];
    assert.deepEqual(names(searcher(repos).search('pay')), [
      'acme/payments',
      'acme/payments-legacy-adapter',
    ]);
  });

  it('treats camelCase humps, dots and underscores as word starts', () => {
    const repos = [
      repo('acme/observer'),
      repo('globex/myHttpServer'),
      repo('acme/hardcore'),
      repo('acme/lib.core'),
      repo('acme/zone_core'),
    ];
    const search = searcher(repos);
    assert.deepEqual(names(search.search('server')), ['globex/myHttpServer', 'acme/observer']);
    assert.deepEqual(names(search.search('core')), [
      'acme/lib.core',
      'acme/zone_core',
      'acme/hardcore',
      'acme/observer',
    ]);
  });

  it('ranks any name match above an owner match', () => {
    const repos = [repo('acme/zebra'), repo('other/acme-tools'), repo('acme/docs')];
    assert.deepEqual(names(searcher(repos).search('acme')), [
      'other/acme-tools',
      'acme/docs',
      'acme/zebra',
    ]);
  });

  it('orders owner matches from exact to substring', () => {
    const repos = [
      repo('teamacme/a'),
      repo('big-acme/b'),
      repo('acme-labs/c'),
      repo('acme/d'),
    ];
    assert.deepEqual(names(searcher(repos).search('acme')), [
      'acme/d',
      'acme-labs/c',
      'big-acme/b',
      'teamacme/a',
    ]);
  });

  it('rewards word starts and close characters in subsequence matches', () => {
    const repos = [repo('acme/feedbacks'), repo('acme/frontend-build-service')];
    const results = searcher(repos).search('fbs');
    assert.deepEqual(names(results), ['acme/frontend-build-service', 'acme/feedbacks']);
    assert.deepEqual(results[0]?.highlights.fullName, [
      [5, 6],
      [14, 15],
      [20, 21],
    ]);
  });

  it('lets a subsequence across owner and name match', () => {
    const results = searcher([repo('acme/gateway')]).search('acmgw');
    assert.deepEqual(names(results), ['acme/gateway']);
    assert.deepEqual(results[0]?.highlights.fullName, [
      [0, 3],
      [5, 6],
      [9, 10],
    ]);
  });

  it('ranks a subsequence above a description match', () => {
    const repos = [
      repo('acme/metrics', { description: 'Dashboards for the ops team' }),
      repo('acme/data-share'),
    ];
    const results = searcher(repos).search('dash');
    assert.deepEqual(names(results), ['acme/data-share', 'acme/metrics']);
    assert.deepEqual(find(results, 'acme/metrics').highlights, {
      fullName: [],
      description: [[0, 4]],
    });
  });

  it('prefers word starts and early matches in the description', () => {
    const repos = [
      repo('acme/one', { description: 'Testkafka harness' }),
      repo('acme/two', { description: 'Mirrors the kafka topics' }),
      repo('acme/three', { description: 'Kafka topic mirror' }),
      repo('acme/four', { description: 'Testkafka harness and kafka tools' }),
    ];
    const results = searcher(repos).search('kafka');
    assert.deepEqual(names(results), ['acme/three', 'acme/two', 'acme/four', 'acme/one']);
    assert.deepEqual(find(results, 'acme/four').highlights.description, [[22, 27]]);
    assert.deepEqual(find(results, 'acme/one').highlights.description, [[4, 9]]);
  });

  it('breaks exact ties by full name, case-insensitively and stable', () => {
    const repos = [
      repo('globex/tools'),
      repo('acme/tools'),
      repo('Beta/tools'),
      repo('ACME/tools'),
    ];
    const expected = ['ACME/tools', 'acme/tools', 'Beta/tools', 'globex/tools'];
    assert.deepEqual(names(searcher(repos).search('tools')), expected);
    assert.deepEqual(names(searcher([...repos].reverse()).search('tools')), expected);
  });

  it('pushes archived repos and forks down without hiding strong matches', () => {
    const repos = [
      repo('acme/web', { archived: true }),
      repo('acme/web-app'),
      repo('acme/api', { fork: true }),
      repo('globex/api'),
    ];
    const search = searcher(repos);
    assert.deepEqual(names(search.search('web', { includeArchived: true })), [
      'acme/web',
      'acme/web-app',
    ]);
    assert.ok(find(search.search('web', { includeArchived: true }), 'acme/web').score < 100);
    assert.deepEqual(names(search.search('api')), ['globex/api', 'acme/api']);
  });

  it('reports the score of an exact, freshly pushed match', () => {
    const results = searcher([repo('acme/api', { pushedAt: daysAgo(0) })]).search('api');
    assert.equal(results[0]?.score, 103);
  });

  it('gives future and invalid push dates the full and no recency bonus', () => {
    const repos = [
      repo('acme/api-a', { pushedAt: 'not a date' }),
      repo('acme/api-b', { pushedAt: new Date(NOW + DAY).toISOString() }),
      repo('acme/api-c', { pushedAt: null }),
    ];
    const results = searcher(repos).search('api');
    assert.deepEqual(names(results), ['acme/api-b', 'acme/api-a', 'acme/api-c']);
    assert.equal(find(results, 'acme/api-b').score - find(results, 'acme/api-a').score, 3);
    assert.equal(find(results, 'acme/api-a').score, find(results, 'acme/api-c').score);
  });

  it('reads the clock on every search', () => {
    let now = NOW;
    const repos = [
      repo('acme/web-app', { pushedAt: daysAgo(10) }),
      repo('acme/web-site', { pushedAt: daysAgo(0) }),
    ];
    const search = createRepoSearcher(repos, { now: () => now });
    const fresh = find(search.search('web'), 'acme/web-site').score;
    now += 300 * DAY;
    assert.ok(find(search.search('web'), 'acme/web-site').score < fresh);
  });

  it('uses the system clock by default', () => {
    const results = createRepoSearcher([
      repo('acme/api', { pushedAt: new Date().toISOString() }),
    ]).search('api');
    assert.ok((results[0]?.score ?? 0) > 102.9);
  });
});

describe('createRepoSearcher terms', () => {
  it('requires every term to match', () => {
    const repos = [repo('acme/api-gateway'), repo('acme/billing-api'), repo('globex/api')];
    const results = searcher(repos).search('acme  api');
    assert.deepEqual(names(results), ['acme/api-gateway', 'acme/billing-api']);
    assert.deepEqual(results[0]?.highlights.fullName, [
      [0, 4],
      [5, 8],
    ]);
    assert.deepEqual(searcher(repos).search('api nothing'), []);
  });

  it('allows terms to match name and description independently', () => {
    const repos = [
      repo('acme/ledger', { description: 'Double entry bookkeeping service' }),
      repo('acme/ledger-ui', { description: 'Frontend' }),
    ];
    const results = searcher(repos).search('ledger bookkeeping');
    assert.deepEqual(names(results), ['acme/ledger']);
    assert.deepEqual(results[0]?.highlights, {
      fullName: [[5, 11]],
      description: [[13, 24]],
    });
  });

  it('merges overlapping highlights of several terms', () => {
    const results = searcher([repo('acme/api-gateway')]).search('api ap gate');
    assert.deepEqual(results[0]?.highlights.fullName, [
      [5, 8],
      [9, 13],
    ]);
  });

  it('matches case- and diacritics-insensitively with original highlight indices', () => {
    const repos = [
      repo('acme/Zürich-Weather'),
      repo('acme/straße-api'),
      repo('acme/menu', { description: 'Das Café-Projekt' }),
    ];
    const search = searcher(repos);
    assert.deepEqual(search.search('ZURICH')[0]?.highlights.fullName, [[5, 11]]);
    assert.deepEqual(names(search.search('zürich weather')), ['acme/Zürich-Weather']);
    assert.deepEqual(search.search('strasse')[0]?.highlights.fullName, [[5, 11]]);
    assert.deepEqual(search.search('STRASSE-API')[0]?.highlights.fullName, [[5, 15]]);
    assert.deepEqual(search.search('stras')[0]?.highlights.fullName, [[5, 10]]);
    assert.deepEqual(search.search('cafe')[0]?.highlights.description, [[4, 8]]);
  });

  it('ignores whitespace-only and slash-only terms', () => {
    const repos = [repo('acme/api', { pushedAt: daysAgo(1) }), repo('acme/web')];
    assert.deepEqual(names(searcher(repos).search(' / // ')), ['acme/api', 'acme/web']);
    assert.deepEqual(names(searcher(repos).search('/ web')), ['acme/web']);
  });
});

describe('createRepoSearcher owner/name terms', () => {
  const repos = [
    repo('other/acme-api'),
    repo('acme-labs/legacy-api'),
    repo('acme/payments'),
    repo('acme/api-gateway'),
    repo('acme/api', { archived: true }),
  ];

  it('strongly prefers the owner and name split at the slash', () => {
    const results = searcher(repos).search('acme/api');
    assert.deepEqual(names(results), [
      'acme/api-gateway',
      'acme-labs/legacy-api',
      'other/acme-api',
    ]);
    const [best, second, third] = results.map((result) => result.score);
    assert.ok(best !== undefined && second !== undefined && third !== undefined);
    assert.ok(best > 90 && second > 64 && third < 50, `${best} ${second} ${third}`);
    assert.deepEqual(results[0]?.highlights.fullName, [
      [0, 4],
      [5, 8],
    ]);
    assert.deepEqual(find(results, 'other/acme-api').highlights.fullName, [
      [6, 10],
      [11, 14],
    ]);
  });

  it('weighs the name segment above the owner segment', () => {
    const results = searcher([
      repo('acme/api-gateway'),
      repo('acme-labs/api'),
      repo('acme/api'),
    ]).search('acme/api');
    assert.deepEqual(names(results), ['acme/api', 'acme-labs/api', 'acme/api-gateway']);
  });

  it('lists the repos of an owner for a trailing slash', () => {
    const results = searcher(repos).search('acme/');
    assert.deepEqual(names(results), [
      'acme/api-gateway',
      'acme/payments',
      'acme-labs/legacy-api',
      'other/acme-api',
    ]);
    assert.deepEqual(results[0]?.highlights.fullName, [[0, 4]]);
  });

  it('matches only the name for a leading slash', () => {
    const results = searcher(repos).search('/api');
    assert.deepEqual(names(results), [
      'acme/api-gateway',
      'other/acme-api',
      'acme-labs/legacy-api',
    ]);
  });

  it('matches abbreviated owner and name segments', () => {
    const results = searcher(repos).search('acm/pmt');
    assert.deepEqual(names(results), ['acme/payments']);
    assert.deepEqual(results[0]?.highlights.fullName, [
      [0, 3],
      [5, 6],
      [8, 9],
      [11, 12],
    ]);
  });

  it('matches word starts and substrings inside the owner segment', () => {
    const search = searcher([repo('big-acme/tools'), repo('teamacme/tools')]);
    assert.deepEqual(names(search.search('acme/tools')), ['big-acme/tools', 'teamacme/tools']);
  });

  it('falls back to the description for slashed terms', () => {
    const results = searcher([
      repo('acme/net', { description: 'A client/server toolkit' }),
    ]).search('client/server');
    assert.deepEqual(results[0]?.highlights, { fullName: [], description: [[2, 15]] });
  });

  it('fails when a part matches nowhere', () => {
    assert.deepEqual(searcher(repos).search('acme/zzz'), []);
  });

  it('treats extra slashes as part separators', () => {
    assert.deepEqual(names(searcher(repos).search('acme//payments')), ['acme/payments']);
  });
});

describe('createRepoSearcher filters and limits', () => {
  const repos = [
    repo('acme/api', { pushedAt: daysAgo(3) }),
    repo('Globex/api-docs', { pushedAt: daysAgo(1) }),
    repo('acme/old-api', { pushedAt: daysAgo(2), archived: true }),
    repo('acme/never-pushed', { pushedAt: null }),
    repo('acme/broken-date', { pushedAt: 'garbage' }),
    repo('globex/web', { pushedAt: daysAgo(30) }),
  ];

  it('returns the most recently pushed repos for an empty query', () => {
    const results = searcher(repos).search('');
    assert.deepEqual(names(results), [
      'Globex/api-docs',
      'acme/api',
      'globex/web',
      'acme/broken-date',
      'acme/never-pushed',
    ]);
    assert.deepEqual(results[0], {
      repo: repos[1],
      score: 0,
      highlights: { fullName: [], description: [] },
    });
    assert.deepEqual(names(searcher(repos).search('   \t ')), names(results));
  });

  it('applies owner filter, archived flag and limit to an empty query', () => {
    const search = searcher(repos);
    assert.deepEqual(names(search.search('', { owner: 'ACME', limit: 2 })), [
      'acme/api',
      'acme/broken-date',
    ]);
    assert.deepEqual(names(search.search('', { includeArchived: true, limit: 3 })), [
      'Globex/api-docs',
      'acme/old-api',
      'acme/api',
    ]);
  });

  it('filters search results by owner case-insensitively', () => {
    const search = searcher(repos);
    assert.deepEqual(names(search.search('api', { owner: 'globex' })), ['Globex/api-docs']);
    assert.deepEqual(names(search.search('web', { owner: ' GLOBEX ' })), ['globex/web']);
    assert.deepEqual(names(search.search('api', { owner: '  ' })), ['acme/api', 'Globex/api-docs']);
  });

  it('hides archived repos unless asked to include them', () => {
    const search = searcher(repos);
    assert.deepEqual(names(search.search('old')), []);
    assert.deepEqual(names(search.search('old', { includeArchived: true })), ['acme/old-api']);
  });

  it('normalizes the limit', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      repo(`acme/svc-${String(i).padStart(2, '0')}`),
    );
    const search = searcher(many);
    assert.equal(search.size, 60);
    assert.equal(search.search('svc').length, DEFAULT_SEARCH_LIMIT);
    assert.equal(search.search('').length, DEFAULT_SEARCH_LIMIT);
    assert.equal(search.search('svc', { limit: Number.NaN }).length, DEFAULT_SEARCH_LIMIT);
    assert.equal(search.search('svc', { limit: 2.9 }).length, 2);
    assert.equal(search.search('svc', { limit: Infinity }).length, 60);
    assert.deepEqual(search.search('svc', { limit: 0 }), []);
    assert.deepEqual(search.search('', { limit: -5 }), []);
  });

  it('handles an empty repo list', () => {
    const search = searcher([]);
    assert.equal(search.size, 0);
    assert.deepEqual(search.search(''), []);
    assert.deepEqual(search.search('api'), []);
  });
});
