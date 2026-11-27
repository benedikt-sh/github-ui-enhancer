import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';

import type { RepoSummary } from '../shared/types.ts';
import { createRepoSearcher } from './fuzzy.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const REPO_COUNT = 10_000;
// The real budget is one frame (16 ms); the bound is generous so slow CI machines do not flake.
const QUERY_BUDGET_MS = 100;
const BUILD_BUDGET_MS = 1000;

const OWNERS = ['acme', 'globex-corp', 'initech', 'umbrella', 'stark-industries', 'wayne-ent'];
const WORDS = [
  'api', 'gateway', 'billing', 'payments', 'auth', 'service', 'frontend', 'backend', 'infra',
  'terraform', 'docs', 'web', 'mobile', 'ios', 'android', 'data', 'pipeline', 'etl', 'ledger',
  'search', 'index', 'worker', 'queue', 'kafka', 'events', 'schema', 'proto', 'client', 'sdk',
  'legacy', 'migration', 'dashboard', 'metrics', 'monitoring', 'alerts', 'config', 'deploy',
  'tools', 'scripts', 'core', 'shared', 'utils', 'design', 'system', 'größe', 'café', 'zürich',
];

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function generateRepos(count: number): RepoSummary[] {
  const random = createRandom(42);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error('empty list');
    }
    return item;
  };
  const words = (min: number, max: number): string[] =>
    Array.from({ length: min + Math.floor(random() * (max - min + 1)) }, () => pick(WORDS));
  return Array.from({ length: count }, (_, i) => {
    const owner = pick(OWNERS);
    const parts = words(1, 4);
    const name =
      random() < 0.2
        ? parts.map((part, k) => (k === 0 ? part : capitalize(part))).join('')
        : `${parts.join(random() < 0.7 ? '-' : '_')}-${i}`;
    const fullName = `${owner}/${name}`;
    return {
      id: `R_${i}`,
      owner,
      name,
      fullName,
      description: random() < 0.8 ? `The ${words(3, 12).join(' ')} project` : null,
      visibility: 'private',
      archived: random() < 0.1,
      fork: random() < 0.05,
      defaultBranch: 'main',
      pushedAt: new Date(NOW - Math.floor(random() * 1000) * 86_400_000).toISOString(),
      url: `https://github.com/${fullName}`,
    };
  });
}

function slowestRun(run: () => void, rounds: number): number {
  let slowest = 0;
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    run();
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

describe('repo search performance', () => {
  const repos = generateRepos(REPO_COUNT);
  const buildStart = performance.now();
  const search = createRepoSearcher(repos, { now: () => NOW });
  const buildTime = performance.now() - buildStart;

  it(`builds the index for ${REPO_COUNT} repos within the budget`, () => {
    assert.ok(buildTime < BUILD_BUDGET_MS, `${buildTime.toFixed(1)} ms`);
  });

  const queries = [
    '',
    'a',
    'api',
    'pay',
    'acme/gate',
    'stark/bill',
    'gtwy',
    'kafka events',
    'zurich',
    'xyzzy',
    'infra terraform deploy',
    'the project',
  ];

  for (const query of queries) {
    it(`answers "${query}" over ${REPO_COUNT} repos within the budget`, () => {
      const slowest = slowestRun(() => search.search(query, { includeArchived: true }), 5);
      assert.ok(slowest < QUERY_BUDGET_MS, `${slowest.toFixed(1)} ms`);
    });
  }

  it('finds matches in the generated data', () => {
    assert.equal(search.size, REPO_COUNT);
    assert.equal(search.search('api', { limit: 20 }).length, 20);
    assert.ok(search.search('acme/gate').every((result) => result.score > 0));
  });
});
