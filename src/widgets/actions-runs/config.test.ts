import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  actionsRunsTitle,
  defaultActionsRunsConfig,
  generatedTitle,
  isRunLimit,
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
    const config = { repo: REPO, branch: 'main', limit: 20, title: 'Deploys' };
    assert.deepEqual(parseActionsRunsConfig(config), config);
  });

  it('accepts the repo as full name and trims texts', () => {
    assert.deepEqual(
      parseActionsRunsConfig({ repo: ' octo/repo ', branch: ' dev ', limit: 5, title: '  ' }),
      { repo: REPO, branch: 'dev', limit: 5, title: null },
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

describe('titles', () => {
  it('generates a title from repo and branch', () => {
    assert.equal(generatedTitle({ repo: null, branch: null }), 'Actions runs');
    assert.equal(generatedTitle({ repo: REPO, branch: null }), 'Actions: octo/repo');
    assert.equal(generatedTitle({ repo: REPO, branch: 'main' }), 'Actions: octo/repo @ main');
  });

  it('prefers the custom title', () => {
    const config = { repo: REPO, branch: null, limit: 10, title: 'Mine' } as const;
    assert.equal(actionsRunsTitle(config), 'Mine');
    assert.equal(actionsRunsTitle({ ...config, title: null }), 'Actions: octo/repo');
  });
});

describe('runsPageUrl', () => {
  it('links the actions page, filtered by branch if set', () => {
    assert.equal(runsPageUrl(REPO, null), 'https://github.com/octo/repo/actions');
    assert.equal(
      runsPageUrl(REPO, 'feature/x y'),
      'https://github.com/octo/repo/actions?query=branch%3Afeature%2Fx%20y',
    );
  });
});
