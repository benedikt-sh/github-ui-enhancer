import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import type { RepoSearchResult } from '../../lib/fuzzy.ts';
import type { RepoSummary } from '../../shared/types.ts';
import { repo } from './repo-search.fixture.ts';
import { highlightedText, repoHref, resultOption } from './result-option.ts';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

function result(
  summary: RepoSummary,
  highlights: Partial<RepoSearchResult['highlights']> = {},
): RepoSearchResult {
  return { repo: summary, score: 1, highlights: { fullName: [], description: [], ...highlights } };
}

function render(summary: RepoSummary, highlights = {}, active = false): HTMLLIElement {
  return resultOption({ result: result(summary, highlights), id: 'opt-1', active, now: NOW });
}

function marks(element: Element | null): string[] {
  return [...(element?.querySelectorAll('mark') ?? [])].map((mark) => mark.textContent);
}

describe('highlightedText', () => {
  it('wraps highlighted segments in mark elements', () => {
    const children = highlightedText('hello world', [[0, 2], [6, 11]]);

    assert.equal(children.length, 3);
    const [first, second, third] = children;
    assert.ok(first instanceof HTMLElement);
    assert.equal(first.tagName, 'MARK');
    assert.equal(first.textContent, 'he');
    assert.equal(second, 'llo ');
    assert.ok(third instanceof HTMLElement);
    assert.equal(third.textContent, 'world');
  });

  it('returns plain text without ranges', () => {
    assert.deepEqual(highlightedText('plain', []), ['plain']);
  });
});

describe('repoHref', () => {
  it('uses the url from the index', () => {
    const summary = repo('acme/app', { url: 'https://github.com/Acme/App' });

    assert.equal(repoHref(summary), 'https://github.com/Acme/App');
  });

  it('falls back to the github url for unsafe urls', () => {
    const unsafe = repo('acme/my app', { url: 'javascript:alert(1)' });

    assert.equal(repoHref(unsafe), 'https://github.com/acme/my%20app');
  });
});

describe('resultOption', () => {
  it('renders a link with option semantics', () => {
    const item = render(repo('acme/app'));
    const option = item.querySelector('a');

    assert.equal(item.getAttribute('role'), 'presentation');
    assert.ok(option);
    assert.equal(option.id, 'opt-1');
    assert.equal(option.getAttribute('role'), 'option');
    assert.equal(option.getAttribute('aria-selected'), 'false');
    assert.equal(option.getAttribute('tabindex'), '-1');
    assert.equal(option.getAttribute('href'), 'https://github.com/acme/app');
    assert.equal(option.dataset['repoId'], 'R_acme/app');
  });

  it('marks the active option as selected', () => {
    const option = render(repo('acme/app'), {}, true).querySelector('a');

    assert.equal(option?.getAttribute('aria-selected'), 'true');
  });

  it('splits the full name into owner and name with highlights in both', () => {
    const item = render(repo('acme/app'), { fullName: [[0, 2], [3, 7]] });

    assert.equal(item.querySelector('.ghx-repo-search__owner')?.textContent, 'acme/');
    assert.equal(item.querySelector('.ghx-repo-search__repo')?.textContent, 'app');
    assert.deepEqual(marks(item.querySelector('.ghx-repo-search__owner')), ['ac', 'e/']);
    assert.deepEqual(marks(item.querySelector('.ghx-repo-search__repo')), ['ap']);
  });

  it('shows a labeled icon per visibility', () => {
    const cases = [
      ['public', 'repo', 'Public repository'],
      ['private', 'lock', 'Private repository'],
      ['internal', 'lock', 'Internal repository'],
    ] as const;
    for (const [visibility, iconName, label] of cases) {
      const item = render(repo('acme/app', { visibility }));
      const wrapper = item.querySelector('.ghx-repo-search__visibility');

      assert.ok(wrapper?.querySelector(`.ghx-icon--${iconName}`));
      assert.equal(wrapper?.querySelector('svg')?.getAttribute('aria-label'), label);
      assert.equal(
        wrapper?.classList.contains('ghx-repo-search__visibility--restricted'),
        visibility !== 'public',
      );
    }
  });

  it('shows archived and fork badges', () => {
    const plain = render(repo('acme/app'));
    const both = render(repo('acme/app', { archived: true, fork: true }));

    assert.equal(plain.querySelectorAll('.ghx-repo-search__badge').length, 0);
    const badges = [...both.querySelectorAll('.ghx-repo-search__badge')];
    assert.deepEqual(badges.map((badge) => badge.textContent), ['Archived', 'Fork']);
  });

  it('renders the description with highlights', () => {
    const item = render(repo('acme/app', { description: 'Billing service' }), {
      description: [[0, 4]],
    });
    const description = item.querySelector('.ghx-repo-search__description');

    assert.equal(description?.textContent, 'Billing service');
    assert.deepEqual(marks(description), ['Bill']);
  });

  it('omits description and pushed time when missing', () => {
    const item = render(repo('acme/app', { description: null, pushedAt: null }));

    assert.equal(item.querySelector('.ghx-repo-search__description'), null);
    assert.equal(item.querySelector('.ghx-repo-search__pushed'), null);
  });

  it('shows the relative pushed time', () => {
    const item = render(repo('acme/app', { pushedAt: '2026-11-26T11:55:00.000Z' }));

    const pushed = item.querySelector('.ghx-repo-search__pushed');

    assert.equal(pushed?.textContent, 'Updated 5 minutes ago');
  });
});
