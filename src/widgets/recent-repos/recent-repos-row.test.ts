import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { describeActivity, recentRepoRow } from './recent-repos-row.ts';
import { NOW, recentRepo } from './recent-repos.fixture.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('describeActivity', () => {
  it('describes every activity kind', () => {
    const cases: [Parameters<typeof describeActivity>[0], string][] = [
      [{ lastActivity: 'push', branch: 'main' }, 'Pushed to main'],
      [{ lastActivity: 'push', branch: null }, 'Pushed'],
      [{ lastActivity: 'pull_request', branch: null }, 'Opened or updated a pull request'],
      [{ lastActivity: 'review', branch: null }, 'Reviewed a pull request'],
      [{ lastActivity: 'issue', branch: null }, 'Opened or updated an issue'],
      [{ lastActivity: 'comment', branch: null }, 'Commented'],
      [{ lastActivity: 'create', branch: 'feat-x' }, 'Created branch feat-x'],
      [{ lastActivity: 'create', branch: null }, 'Created a tag or the repository'],
      [{ lastActivity: 'release', branch: null }, 'Published a release'],
      [{ lastActivity: 'other', branch: null }, 'Other activity'],
    ];
    for (const [item, expected] of cases) {
      assert.equal(describeActivity(item), expected);
    }
  });
});

describe('recentRepoRow', () => {
  it('renders the repository with a muted owner, activity, time and counter', () => {
    const row = recentRepoRow(recentRepo(), NOW);

    assert.equal(row.tagName, 'LI');
    assert.equal(row.dataset['repo'], 'octo/repo');
    const repo = row.querySelector<HTMLAnchorElement>('a.ghx-row__title');
    assert.equal(repo?.getAttribute('href'), 'https://github.com/octo/repo');
    assert.equal(repo?.textContent, 'octo/repo');
    assert.equal(repo?.querySelector('.ghx-recent-repos__owner')?.textContent, 'octo/');
    const meta = [...row.querySelectorAll('.ghx-row__meta-item')].map((item) => item.textContent);
    assert.deepEqual(meta, ['Pushed to main', '1 hour ago']);
    assert.equal(row.querySelector('time')?.getAttribute('datetime'), '2026-11-26T11:00:00.000Z');
    assert.ok(row.querySelector('.ghx-row__icon .ghx-icon--git-branch'));
    const counter = row.querySelector('.ghx-counter');
    assert.equal(counter?.textContent, '3');
    assert.equal(counter?.getAttribute('aria-label'), '3 recent events');
    assert.equal(counter?.getAttribute('title'), '3 recent events');
  });

  it('uses the singular for one event and an icon per activity', () => {
    const row = recentRepoRow(recentRepo({ activityCount: 1, lastActivity: 'review' }), NOW);

    assert.equal(row.querySelector('.ghx-counter')?.getAttribute('aria-label'), '1 recent event');
    assert.ok(row.querySelector('.ghx-row__icon .ghx-icon--eye'));
  });

  it('links to the pull requests and actions of the repository', () => {
    const row = recentRepoRow(recentRepo(), NOW);

    const links = [...row.querySelectorAll<HTMLAnchorElement>('.ghx-recent-repos__quick-link')];
    assert.deepEqual(
      links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
      [
        ['Pull requests of octo/repo', 'https://github.com/octo/repo/pulls'],
        ['Actions of octo/repo', 'https://github.com/octo/repo/actions'],
      ],
    );
    assert.equal(links[0]?.title, 'Pull requests of octo/repo');
  });

  it('encodes repository names in links instead of trusting the item url', () => {
    const row = recentRepoRow(
      recentRepo({ repo: { owner: 'octo', name: 'a b' }, url: 'javascript:alert(1)' }),
      NOW,
    );

    const hrefs = [...row.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    assert.deepEqual(hrefs, [
      'https://github.com/octo/a%20b',
      'https://github.com/octo/a%20b/pulls',
      'https://github.com/octo/a%20b/actions',
    ]);
  });
});
