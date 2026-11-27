import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { RepoRef } from '../../shared/types.ts';
import {
  chunkRepos,
  DATA_LAYER_PREFIX,
  dependabotQuery,
  dependabotSearchUrl,
  DEPENDABOT_QUERY,
  MAX_QUERY_LENGTH,
  SCOPE_RESERVE,
  searchDependabotPullRequests,
  sentQueryLength,
} from './dependabot-prs-search.ts';
import { NOW, pullRequest, repo } from './dependabot-prs.fixture.ts';

const now = (): Date => NOW;
const options = { limit: 10, forceRefresh: false, now };

/** Owner with the maximum login length of 39 and an 80 character name. */
function longRepo(index: number): RepoRef {
  return {
    owner: `owner-${String(index).padStart(2, '0')}-${'o'.repeat(30)}`,
    name: `repo-${String(index).padStart(2, '0')}-${'n'.repeat(72)}`,
  };
}

describe('dependabotQuery', () => {
  it('appends a repo qualifier per repository', () => {
    assert.equal(
      dependabotQuery([repo('octo/api'), repo('acme/web')]),
      `${DEPENDABOT_QUERY} repo:octo/api repo:acme/web`,
    );
    assert.equal(dependabotQuery([]), DEPENDABOT_QUERY);
  });

  it('only finds open, unarchived Dependabot pull requests, newest first', () => {
    assert.equal(
      DEPENDABOT_QUERY,
      'is:open archived:false author:app/dependabot sort:updated-desc',
    );
  });
});

describe('sentQueryLength', () => {
  it('counts the prefix of the data layer and the reserve for its org scope', () => {
    const repos = [repo('octo/api')];
    assert.equal(
      sentQueryLength(repos),
      DATA_LAYER_PREFIX.length + dependabotQuery(repos).length + SCOPE_RESERVE,
    );
    assert.equal(SCOPE_RESERVE, 44);
  });
});

describe('chunkRepos', () => {
  it('returns no chunks without repos', () => {
    assert.deepEqual(chunkRepos([]), []);
  });

  it('keeps short repo lists in one chunk', () => {
    const repos = [repo('octo/api'), repo('octo/web'), repo('acme/tools')];
    assert.deepEqual(chunkRepos(repos), [repos]);
  });

  it('splits long repo names into chunks below the query limit, keeping the order', () => {
    const repos = Array.from({ length: 30 }, (_, index) => ({
      owner: `organization-${index}`,
      name: `a-rather-long-repository-name-${index}`,
    }));
    const chunks = chunkRepos(repos);

    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat(), repos);
    for (const chunk of chunks) {
      const sent = `${DATA_LAYER_PREFIX}${dependabotQuery(chunk)}`;
      assert.ok(sent.length + SCOPE_RESERVE < MAX_QUERY_LENGTH, `${sent.length} too long`);
    }
    // Greedy: adding the first repo of the next chunk would exceed the limit.
    for (let index = 0; index < chunks.length - 1; index += 1) {
      const next = chunks[index + 1]?.[0];
      assert.ok(next);
      assert.ok(sentQueryLength([...(chunks[index] ?? []), next]) >= MAX_QUERY_LENGTH);
    }
  });

  it('puts repos with maximum length names into chunks of their own', () => {
    const repos = [longRepo(1), longRepo(2), longRepo(3)];
    for (const entry of repos) {
      assert.ok(sentQueryLength([entry]) < MAX_QUERY_LENGTH);
    }
    assert.deepEqual(chunkRepos(repos), [[longRepo(1)], [longRepo(2)], [longRepo(3)]]);
  });

  it('still sends a repo that does not fit even alone', () => {
    const repos = [repo('octo/api'), repo('octo/web')];
    assert.deepEqual(chunkRepos(repos, 10), [[repo('octo/api')], [repo('octo/web')]]);
  });

  it('splits exactly at the limit', () => {
    const two = [repo('octo/api'), repo('octo/web')];
    assert.deepEqual(chunkRepos(two, sentQueryLength(two) + 1), [two]);
    assert.deepEqual(chunkRepos(two, sentQueryLength(two)), [[two[0]], [two[1]]]);
  });
});

describe('dependabotSearchUrl', () => {
  it('links to the pull request search of all repositories', () => {
    assert.equal(
      dependabotSearchUrl([repo('octo/api'), repo('acme/web')]),
      'https://github.com/pulls?q=is%3Apr%20is%3Aopen%20archived%3Afalse%20author%3Aapp%2Fdependabot' +
        '%20sort%3Aupdated-desc%20repo%3Aocto%2Fapi%20repo%3Aacme%2Fweb',
    );
  });
});

describe('searchDependabotPullRequests', () => {
  it('returns an empty result without repos and does not search', async () => {
    const data = createFakeWidgetData();
    const result = await searchDependabotPullRequests(data, [], options);

    assert.deepEqual(result, {
      data: [],
      errors: [],
      fetchedAt: NOW.toISOString(),
      stale: false,
    });
    assert.equal(data.calls.length, 0);
  });

  it('searches one query for few repos and passes the options', async () => {
    const data = createFakeWidgetData();
    data.handle('searchPullRequests', async () => dataResult([pullRequest()]));
    const result = await searchDependabotPullRequests(data, [repo('octo/api')], {
      limit: 5,
      forceRefresh: true,
      now,
    });

    assert.deepEqual(data.callsTo('searchPullRequests'), [
      [`${DEPENDABOT_QUERY} repo:octo/api`, { limit: 5, forceRefresh: true }],
    ]);
    assert.deepEqual(result, dataResult([pullRequest()]));
  });

  it('fires all chunk searches at once', () => {
    const data = createFakeWidgetData();
    data.handle('searchPullRequests', () => new Promise(() => {}));
    const repos = [longRepo(1), longRepo(2), longRepo(3)];
    void searchDependabotPullRequests(data, repos, options);

    assert.deepEqual(
      data.callsTo('searchPullRequests').map(([query]) => query),
      repos.map((entry) => dependabotQuery([entry])),
    );
  });

  it('merges chunks, dedupes by id, sorts by update time and applies the limit', async () => {
    const data = createFakeWidgetData();
    const answers = [
      dataResult(
        [
          pullRequest({ id: 'A', updatedAt: '2026-11-26T08:00:00Z' }),
          pullRequest({ id: 'B', updatedAt: '2026-11-26T10:00:00Z' }),
        ],
        { fetchedAt: '2026-11-26T11:00:00.000Z', errors: [{ kind: 'network', message: 'a' }] },
      ),
      dataResult(
        [
          pullRequest({ id: 'C', updatedAt: '2026-11-26T11:00:00Z' }),
          pullRequest({ id: 'B', title: 'Duplicate', updatedAt: '2026-11-26T10:00:00Z' }),
          pullRequest({ id: 'D', updatedAt: '2026-11-25T10:00:00Z' }),
        ],
        { fetchedAt: '2026-11-26T09:00:00.000Z', stale: true },
      ),
      dataResult([pullRequest({ id: 'E', updatedAt: '2026-11-26T09:00:00Z' })], {
        fetchedAt: '2026-11-26T10:00:00.000Z',
        errors: [{ kind: 'rate_limited', message: 'b' }],
      }),
    ];
    let index = 0;
    data.handle('searchPullRequests', async () => {
      const answer = answers[index];
      index += 1;
      assert.ok(answer);
      return answer;
    });
    const result = await searchDependabotPullRequests(
      data,
      [longRepo(1), longRepo(2), longRepo(3)],
      { ...options, limit: 4 },
    );

    assert.deepEqual(
      result.data.map((item) => item.id),
      ['C', 'B', 'E', 'A'],
    );
    assert.notEqual(result.data[1]?.title, 'Duplicate');
    assert.deepEqual(result.errors, [
      { kind: 'network', message: 'a' },
      { kind: 'rate_limited', message: 'b' },
    ]);
    assert.equal(result.fetchedAt, '2026-11-26T09:00:00.000Z');
    assert.equal(result.stale, true);
  });

  it('turns rejected chunks into errors when others succeed', async () => {
    const data = createFakeWidgetData();
    let index = 0;
    data.handle('searchPullRequests', async () => {
      index += 1;
      if (index === 2) {
        throw new ApiError({ kind: 'network', message: 'offline' });
      }
      return dataResult([pullRequest({ id: `PR_${index}` })]);
    });
    const result = await searchDependabotPullRequests(
      data,
      [longRepo(1), longRepo(2)],
      options,
    );

    assert.deepEqual(
      result.data.map((item) => item.id),
      ['PR_1'],
    );
    assert.deepEqual(result.errors, [{ kind: 'network', message: 'offline' }]);
    assert.equal(result.stale, false);
  });

  it('rejects with the first error when every chunk fails', async () => {
    const data = createFakeWidgetData();
    let index = 0;
    data.handle('searchPullRequests', async () => {
      index += 1;
      throw new ApiError({ kind: 'internal', message: `failure ${index}` });
    });

    await assert.rejects(
      searchDependabotPullRequests(data, [longRepo(1), longRepo(2)], options),
      { message: 'failure 1' },
    );
  });
});
