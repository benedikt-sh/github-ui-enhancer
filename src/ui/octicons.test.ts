import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { SVG_NAMESPACE } from './dom.ts';
import { icon, ICON_NAMES } from './octicons.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REQUIRED = [
  'git-pull-request',
  'git-pull-request-draft',
  'git-pull-request-closed',
  'git-merge',
  'issue-opened',
  'issue-closed',
  'skip',
  'check',
  'check-circle',
  'x',
  'x-circle',
  'dot-fill',
  'clock',
  'sync',
  'gear',
  'plus',
  'trash',
  'kebab-horizontal',
  'search',
  'repo',
  'lock',
  'archive',
  'play',
  'stop',
  'alert',
  'link-external',
  'comment',
  'eye',
  'chevron-up',
  'chevron-down',
  'grabber',
  'git-branch',
  'workflow',
];

describe('icon', () => {
  it('provides every icon the widgets need', () => {
    for (const name of REQUIRED) {
      assert.ok((ICON_NAMES as string[]).includes(name), name);
    }
  });

  it('renders a decorative 16px svg hidden from assistive technology', () => {
    const element = icon('check');

    assert.equal(element.namespaceURI, SVG_NAMESPACE);
    assert.equal(element.getAttribute('class'), 'ghx-icon ghx-icon--check');
    assert.equal(element.getAttribute('viewBox'), '0 0 16 16');
    assert.equal(element.getAttribute('width'), '16');
    assert.equal(element.getAttribute('height'), '16');
    assert.equal(element.getAttribute('fill'), 'currentColor');
    assert.equal(element.getAttribute('aria-hidden'), 'true');
    assert.equal(element.hasAttribute('role'), false);
    assert.equal(element.hasAttribute('aria-label'), false);
  });

  it('renders all paths of multi-path icons', () => {
    const paths = icon('issue-opened').querySelectorAll('path');

    assert.equal(paths.length, 2);
    for (const path of paths) {
      assert.match(path.getAttribute('d') ?? '', /^M/);
    }
  });

  it('exposes labeled icons as images', () => {
    const element = icon('lock', { label: 'Private', className: 'extra' });

    assert.equal(element.getAttribute('role'), 'img');
    assert.equal(element.getAttribute('aria-label'), 'Private');
    assert.equal(element.hasAttribute('aria-hidden'), false);
    assert.equal(element.getAttribute('class'), 'ghx-icon ghx-icon--lock extra');
  });

  it('treats an empty label as decorative', () => {
    assert.equal(icon('x', { label: '' }).getAttribute('aria-hidden'), 'true');
  });
});
