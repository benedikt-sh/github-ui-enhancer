import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  actionsRunsTitle,
  defaultActionsRunsConfig,
  generatedTitle,
  isRunLimit,
  isRunStatusFilter,
  parseActionsRunsConfig,
  runsPageUrl,
} from './config.ts';

const REPO = { owner: 'octo', name: 'repo' };

describe('parseActionsRunsConfig', () => {
  it('returns defaults for values that are not objects', () => {
    for (const raw of [undefined, null, 'x', 42, []]) {
      assert.deepEqual(parseActionsRunsConfig(raw), defaultActionsRunsConfig());
    }
  });

  it('keeps a valid config', () => {
    const config = {
      repo: REPO,
      branch: 'main',
      limit: 20,
      status: 'failure',
      title: 'Deploys',
    };
    assert.deepEqual(parseActionsRunsConfig(config), config);
  });

  it('shows all runs for configs stored without a status filter', () => {
    const stored = { repo: REPO, branch: 'main', limit: 20, title: null };
    assert.deepEqual(parseActionsRunsConfig(stored), {
      repo: REPO,
      branch: 'main',
      limit: 20,
      status: 'all',
      title: null,
    });
  });

  it('falls back to all runs for unknown status filters', () => {
    for (const status of ['success', 'FAILURE', 1, null]) {
      assert.equal(parseActionsRunsConfig({ repo: REPO, status }).status, 'all');
    }
  });

  it('keeps the status filter without a repo', () => {
    assert.deepEqual(parseActionsRunsConfig({ status: 'failure' }), {
      ...defaultActionsRunsConfig(),
      status: 'failure',
    });
  });

  it('accepts the repo as full name and trims texts', () => {
    assert.deepEqual(
      parseActionsRunsConfig({ repo: ' octo/repo ', branch: ' dev ', limit: 5, title: '  ' }),
      { repo: REPO, branch: 'dev', limit: 5, status: 'all', title: null },
    );
  });

  it('falls back per field for invalid parts', () => {
    assert.deepEqual(
      parseActionsRunsConfig({ repo: { owner: 'a b', name: 'c' }, branch: 'main', limit: 7 }),
      defaultActionsRunsConfig(),
    );
    assert.deepEqual(
      parseActionsRunsConfig({ repo: { owner: 'octo', name: 3 }, title: 5 }),
      defaultActionsRunsConfig(),
    );
    assert.deepEqual(parseActionsRunsConfig({ repo: 'octo', limit: 5 }), {
      ...defaultActionsRunsConfig(),
      limit: 5,
    });
    assert.deepEqual(parseActionsRunsConfig({ repo: REPO, branch: 1, limit: '10', title: 'T' }), {
      repo: REPO,
      branch: null,
      limit: 10,
      status: 'all',
      title: 'T',
    });
  });
});

describe('isRunLimit', () => {
  it('accepts only the offered limits', () => {
    assert.equal(isRunLimit(5), true);
    assert.equal(isRunLimit(20), true);
    assert.equal(isRunLimit(15), false);
    assert.equal(isRunLimit('5'), false);
  });
});

describe('isRunStatusFilter', () => {
  it('accepts only the offered filters', () => {
    assert.equal(isRunStatusFilter('all'), true);
    assert.equal(isRunStatusFilter('failure'), true);
    assert.equal(isRunStatusFilter('success'), false);
    assert.equal(isRunStatusFilter(undefined), false);
  });
});

describe('titles', () => {
  it('generates a title from repo and branch', () => {
    assert.equal(generatedTitle({ repo: null, branch: null, status: 'all' }), 'Actions runs');
    assert.equal(generatedTitle({ repo: REPO, branch: null, status: 'all' }), 'Actions: octo/repo');
    assert.equal(
      generatedTitle({ repo: REPO, branch: 'main', status: 'all' }),
      'Actions: octo/repo @ main',
    );
  });

  it('marks the failed runs filter', () => {
    assert.equal(
      generatedTitle({ repo: REPO, branch: 'main', status: 'failure' }),
      'Actions: octo/repo @ main (failed)',
    );
    assert.equal(
      generatedTitle({ repo: REPO, branch: null, status: 'failure' }),
      'Actions: octo/repo (failed)',
    );
    assert.equal(generatedTitle({ repo: null, branch: null, status: 'failure' }), 'Actions runs');
  });

  it('prefers the custom title', () => {
    const config = {
      repo: REPO,
      branch: null,
      limit: 10,
      status: 'failure',
      title: 'Mine',
    } as const;
    assert.equal(actionsRunsTitle(config), 'Mine');
    assert.equal(actionsRunsTitle({ ...config, title: null }), 'Actions: octo/repo (failed)');
  });
});

describe('runsPageUrl', () => {
  it('links the actions page, filtered by branch if set', () => {
    assert.equal(runsPageUrl(REPO, null, 'all'), 'https://github.com/octo/repo/actions');
    assert.equal(
      runsPageUrl(REPO, 'feature/x y', 'all'),
      'https://github.com/octo/repo/actions?query=branch%3Afeature%2Fx%20y',
    );
  });

  it('adds the failure filter to the query', () => {
    assert.equal(
      runsPageUrl(REPO, null, 'failure'),
      'https://github.com/octo/repo/actions?query=is%3Afailure',
    );
    const url = new URL(runsPageUrl(REPO, 'a&b', 'failure'));
    assert.equal(url.searchParams.get('query'), 'branch:a&b is:failure');
    assert.equal(url.search, '?query=branch%3Aa%26b%20is%3Afailure');
  });
});
