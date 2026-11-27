import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_TITLE,
  defaultDependabotPrsConfig,
  dependabotPrsTitle,
  generatedTitle,
  isDependabotLimit,
  MAX_REPOS,
  normalizeTitle,
  parseDependabotPrsConfig,
  parseRepos,
  repoKey,
  sameRepo,
} from './dependabot-prs-config.ts';

describe('defaultDependabotPrsConfig', () => {
  it('starts without repositories', () => {
    assert.deepEqual(defaultDependabotPrsConfig(), {
      repos: [],
      title: null,
      limit: 10,
      groupByRepo: false,
    });
  });
});

describe('isDependabotLimit', () => {
  it('accepts only the offered limits', () => {
    assert.equal(isDependabotLimit(5), true);
    assert.equal(isDependabotLimit(50), true);
    assert.equal(isDependabotLimit(7), false);
    assert.equal(isDependabotLimit('10'), false);
  });
});

describe('repoKey and sameRepo', () => {
  it('compare repositories case-insensitively', () => {
    assert.equal(repoKey({ owner: 'Octo', name: 'API' }), 'octo/api');
    assert.equal(sameRepo({ owner: 'Octo', name: 'API' }, { owner: 'octo', name: 'api' }), true);
    assert.equal(sameRepo({ owner: 'octo', name: 'api' }, { owner: 'octo', name: 'web' }), false);
  });
});

describe('parseRepos', () => {
  it('returns an empty list for non-arrays', () => {
    assert.deepEqual(parseRepos(undefined), []);
    assert.deepEqual(parseRepos('octo/api'), []);
    assert.deepEqual(parseRepos({ owner: 'octo', name: 'api' }), []);
  });

  it('accepts refs and full names and drops invalid entries', () => {
    assert.deepEqual(
      parseRepos([
        { owner: 'octo', name: 'api' },
        'acme/web',
        ' acme/tools ',
        'not a repo',
        'a/b/c',
        { owner: 'octo' },
        { owner: 'bad owner', name: 'x' },
        42,
        null,
      ]),
      [
        { owner: 'octo', name: 'api' },
        { owner: 'acme', name: 'web' },
        { owner: 'acme', name: 'tools' },
      ],
    );
  });

  it('deduplicates case-insensitively and keeps the first spelling', () => {
    assert.deepEqual(parseRepos(['Octo/Api', 'octo/api', { owner: 'OCTO', name: 'API' }]), [
      { owner: 'Octo', name: 'Api' },
    ]);
  });

  it('keeps at most the maximum number of repositories', () => {
    const many = Array.from({ length: MAX_REPOS + 5 }, (_, index) => `octo/repo-${index}`);
    const repos = parseRepos(many);
    assert.equal(repos.length, MAX_REPOS);
    assert.deepEqual(repos.at(-1), { owner: 'octo', name: `repo-${MAX_REPOS - 1}` });
  });
});

describe('normalizeTitle', () => {
  it('trims and maps empty or invalid values to null', () => {
    assert.equal(normalizeTitle('  Deps  '), 'Deps');
    assert.equal(normalizeTitle('   '), null);
    assert.equal(normalizeTitle(3), null);
  });
});

describe('parseDependabotPrsConfig', () => {
  it('falls back to the defaults for non-objects', () => {
    assert.deepEqual(parseDependabotPrsConfig(null), defaultDependabotPrsConfig());
    assert.deepEqual(parseDependabotPrsConfig([]), defaultDependabotPrsConfig());
    assert.deepEqual(parseDependabotPrsConfig('x'), defaultDependabotPrsConfig());
  });

  it('parses a complete config', () => {
    assert.deepEqual(
      parseDependabotPrsConfig({
        repos: ['octo/api', { owner: 'acme', name: 'web' }],
        title: ' Updates ',
        limit: 20,
        groupByRepo: true,
      }),
      {
        repos: [
          { owner: 'octo', name: 'api' },
          { owner: 'acme', name: 'web' },
        ],
        title: 'Updates',
        limit: 20,
        groupByRepo: true,
      },
    );
  });

  it('falls back per field', () => {
    assert.deepEqual(
      parseDependabotPrsConfig({ repos: 'octo/api', title: 1, limit: 7, groupByRepo: 'yes' }),
      defaultDependabotPrsConfig(),
    );
  });
});

describe('generatedTitle and dependabotPrsTitle', () => {
  it('derives the title from the repositories', () => {
    assert.equal(generatedTitle([]), DEFAULT_TITLE);
    assert.equal(generatedTitle([{ owner: 'octo', name: 'api' }]), 'Dependabot: octo/api');
    assert.equal(
      generatedTitle([
        { owner: 'octo', name: 'api' },
        { owner: 'octo', name: 'web' },
      ]),
      'Dependabot: 2 repositories',
    );
  });

  it('prefers a custom title', () => {
    const config = { ...defaultDependabotPrsConfig(), repos: [{ owner: 'octo', name: 'api' }] };
    assert.equal(dependabotPrsTitle(config), 'Dependabot: octo/api');
    assert.equal(dependabotPrsTitle({ ...config, title: 'Mine' }), 'Mine');
  });
});
