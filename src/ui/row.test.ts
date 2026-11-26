import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { Actor } from '../shared/types.ts';
import { h } from './dom.ts';
import {
  actorLink,
  avatar,
  avatarStack,
  commentCount,
  itemList,
  itemRow,
  link,
  repoLink,
  repoUrl,
  statusIcon,
  statusText,
  toneClass,
} from './row.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const actor = (login: string): Actor => ({
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/1?u=${login}`,
  url: `https://github.com/${login}`,
});

describe('status helpers', () => {
  it('renders a labeled status icon with tone', () => {
    const element = statusIcon({ icon: 'check', tone: 'success', label: 'Passed' }, 'extra');
    const svgElement = element.querySelector('svg');

    assert.equal(element.className, 'ghx-status ghx-tone--success extra');
    assert.equal(element.title, 'Passed');
    assert.equal(svgElement?.getAttribute('aria-label'), 'Passed');
    assert.equal(svgElement?.getAttribute('role'), 'img');
  });

  it('renders a status with visible text and a decorative icon', () => {
    const element = statusText({ icon: 'eye', tone: 'attention', label: 'Review required' });

    assert.equal(element.className, 'ghx-status-text ghx-tone--attention');
    assert.equal(element.textContent, 'Review required');
    assert.equal(element.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });

  it('builds tone classes', () => {
    assert.equal(toneClass('done'), 'ghx-tone--done');
  });
});

describe('links', () => {
  it('builds encoded repository URLs and links', () => {
    assert.equal(repoUrl({ owner: 'octo', name: 'a b' }), 'https://github.com/octo/a%20b');
    const element = repoLink({ owner: 'octo', name: 'repo' });

    assert.equal(element.getAttribute('href'), 'https://github.com/octo/repo');
    assert.equal(element.textContent, 'octo/repo');
    assert.equal(element.className, 'ghx-row__repo');
  });

  it('renders text instead of links for unsafe URLs', () => {
    const safe = link('Title', 'https://github.com/x', 'cls');
    const unsafe = link('Title', 'javascript:alert(1)', 'cls');

    assert.equal(safe.tagName, 'A');
    assert.equal(safe.getAttribute('href'), 'https://github.com/x');
    assert.equal(unsafe.tagName, 'SPAN');
    assert.equal(unsafe.className, 'cls');
    assert.equal(unsafe.hasAttribute('href'), false);
  });

  it('links actors and shows deleted ones as ghost', () => {
    const element = actorLink(actor('octocat'));

    assert.equal(element.getAttribute('href'), 'https://github.com/octocat');
    assert.equal(element.textContent, 'octocat');
    assert.equal(actorLink(null).textContent, 'ghost');
    assert.equal(actorLink(null).tagName, 'SPAN');
  });
});

describe('avatars', () => {
  it('renders an avatar image with alt text', () => {
    const image = avatar(actor('octocat'));

    assert.equal(image?.getAttribute('alt'), '@octocat');
    assert.equal(image?.getAttribute('width'), '20');
    assert.equal(image?.getAttribute('loading'), 'lazy');
    assert.equal(avatar({ ...actor('x'), avatarUrl: 'javascript:alert(1)' }), null);
  });

  it('stacks up to the maximum and counts the rest', () => {
    const stack = avatarStack(['a', 'b', 'c', 'd', 'e'].map(actor), 'Assigned to');

    assert.equal(stack?.getAttribute('aria-label'), 'Assigned to: a, b, c, d, e');
    assert.equal(stack?.querySelectorAll('img').length, 3);
    assert.equal(stack?.querySelector('.ghx-avatars__more')?.textContent, '+2');
  });

  it('omits the counter when all avatars fit and the stack without avatars', () => {
    const stack = avatarStack([actor('a')], 'Assigned to', 2);

    assert.equal(stack?.querySelector('.ghx-avatars__more'), null);
    assert.equal(avatarStack([], 'Assigned to'), null);
  });
});

describe('commentCount', () => {
  it('is hidden without comments', () => {
    assert.equal(commentCount(0), null);
  });

  it('shows the count with an accessible label', () => {
    assert.equal(commentCount(1)?.getAttribute('aria-label'), '1 comment');
    const element = commentCount(7);

    assert.equal(element?.getAttribute('aria-label'), '7 comments');
    assert.equal(element?.textContent, '7');
    assert.ok(element?.querySelector('.ghx-icon--comment'));
  });
});

describe('itemRow', () => {
  it('renders the minimal row', () => {
    const row = itemRow({
      id: 42,
      status: { icon: 'issue-opened', tone: 'success', label: 'Open issue' },
      title: 'Fix it',
      url: 'https://github.com/o/r/issues/1',
    });

    assert.equal(row.tagName, 'LI');
    assert.equal(row.className, 'ghx-row');
    assert.equal(row.dataset['id'], '42');
    assert.ok(row.querySelector('.ghx-row__icon.ghx-tone--success'));
    assert.equal(row.querySelector('.ghx-row__title')?.textContent, 'Fix it');
    assert.equal(row.querySelector('.ghx-row__repo'), null);
    assert.equal(row.querySelector('.ghx-labels'), null);
    assert.equal(row.querySelector('.ghx-row__meta'), null);
    assert.equal(row.querySelector('.ghx-row__side'), null);
  });

  it('renders repo, labels, meta and side and skips empty entries', () => {
    const row = itemRow({
      id: 'x',
      className: 'ghx-row--custom',
      status: { icon: 'git-merge', tone: 'done', label: 'Merged' },
      title: 'Title',
      url: 'https://github.com/o/r/pull/1',
      repo: { owner: 'o', name: 'r' },
      labels: [{ name: 'bug', color: 'd73a4a' }],
      meta: ['#1', null, false, '', ['by ', h('b', null, 'me')]],
      side: [h('span', null, 'side'), undefined],
    });
    const metaItems = row.querySelectorAll('.ghx-row__meta-item');

    assert.ok(row.classList.contains('ghx-row--custom'));
    assert.equal(row.querySelector('.ghx-row__repo')?.textContent, 'o/r');
    assert.equal(row.querySelectorAll('.ghx-label').length, 1);
    assert.deepEqual(
      [...metaItems].map((item) => item.textContent),
      ['#1', 'by me'],
    );
    assert.equal(row.querySelector('.ghx-row__side')?.textContent, 'side');
  });

  it('keeps titles with markup as text', () => {
    const title = '<img src=x onerror=alert(1)>';
    const row = itemRow({
      id: 1,
      status: { icon: 'x', tone: 'danger', label: 'x' },
      title,
      url: 'https://github.com/',
    });

    assert.equal(row.querySelector('img'), null);
    assert.equal(row.querySelector('.ghx-row__title')?.textContent, title);
  });
});

describe('itemList', () => {
  it('wraps rows in a labeled list', () => {
    const rows = [h('li', null, 'a'), h('li', null, 'b')];
    const list = itemList(rows, { label: 'Pull requests', className: 'extra' });

    assert.equal(list.tagName, 'UL');
    assert.equal(list.className, 'ghx-list extra');
    assert.equal(list.getAttribute('aria-label'), 'Pull requests');
    assert.equal(list.children.length, 2);
  });
});
