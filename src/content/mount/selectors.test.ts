import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { renderFileList } from '../file-icons/file-list.fixture.ts';
import { renderPage } from './github-page.fixture.ts';
import {
  fileListCellOf,
  findChangelogWidgets,
  findFileListCells,
  findHeaderSlot,
  findMountPoint,
  isInHeaderSlot,
  isLoggedIn,
  isRepositoryCodePath,
  isStartPath,
  pageLogin,
  readFileListEntry,
} from './selectors.ts';

describe('selectors', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  it('treats only the root path as start page', () => {
    assert.equal(isStartPath('/'), true);
    assert.equal(isStartPath('/feed'), false);
    assert.equal(isStartPath('/octocat'), false);
    assert.equal(isStartPath(''), false);
  });

  it('detects the login from the meta tag', () => {
    renderPage(document, { login: 'octocat' });
    assert.equal(isLoggedIn(document), true);

    renderPage(document, { login: '' });
    assert.equal(isLoggedIn(document), false);

    renderPage(document, { login: '  ' });
    assert.equal(isLoggedIn(document), false);

    renderPage(document, { login: null });
    assert.equal(isLoggedIn(document), false);
  });

  it('reads the trimmed login of the signed-in user', () => {
    renderPage(document, { login: ' octocat ' });
    assert.equal(pageLogin(document), 'octocat');

    renderPage(document, { login: '' });
    assert.equal(pageLogin(document), null);

    renderPage(document, { login: null });
    assert.equal(pageLogin(document), null);
  });

  it('prefers main as container', () => {
    renderPage(document, { variant: 'main' });

    assert.deepEqual(findMountPoint(document, null), {
      placement: 'first-child',
      container: document.querySelector('main'),
    });
  });

  it('falls back to role=main and .application-main', () => {
    renderPage(document, { variant: 'role-main' });
    assert.equal(findMountPoint(document, null)?.container, document.querySelector('[role=main]'));

    renderPage(document, { variant: 'application-main' });
    assert.equal(
      findMountPoint(document, null)?.container,
      document.querySelector('.application-main'),
    );
  });

  it('falls back to inserting after the header wrapper', () => {
    renderPage(document, { variant: 'header-only' });
    const wrapper = document.querySelector('.js-header-wrapper');

    assert.deepEqual(findMountPoint(document, null), {
      placement: 'after-header',
      container: document.querySelector('[data-turbo-body]'),
      header: wrapper,
    });
  });

  it('tries every header selector in order', () => {
    const cases = [
      { html: '<header class="AppHeader"></header>', selector: 'header.AppHeader' },
      { html: '<header role="banner"></header>', selector: 'header[role="banner"]' },
      { html: '<div><header></header></div>', selector: 'header' },
    ];
    for (const { html, selector } of cases) {
      document.body.innerHTML = `${html}<div>content</div>`;
      const point = findMountPoint(document, null);
      assert.ok(point?.placement === 'after-header', selector);
      assert.equal(point.header, document.querySelector(selector), selector);
    }
  });

  it('returns null without any known element', () => {
    renderPage(document, { variant: 'bare' });
    assert.equal(findMountPoint(document, null), null);
  });

  it('ignores a header without parent element', () => {
    document.body.innerHTML = '<div>content</div>';
    document.documentElement.classList.add('js-header-wrapper');

    assert.equal(findMountPoint(document, null), null);
    document.documentElement.classList.remove('js-header-wrapper');
  });

  it('skips matches inside the excluded element', () => {
    renderPage(document, { variant: 'role-main' });
    const own = document.createElement('div');
    own.innerHTML = '<main>widget</main>';
    document.body.prepend(own);

    assert.equal(findMountPoint(document, own)?.container, document.querySelector('[role=main]'));
    assert.equal(findMountPoint(document, null)?.container, own.firstElementChild);
  });
});

describe('findChangelogWidgets', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  function render(html: string): void {
    document.body.innerHTML = html;
  }

  it('finds known changelog hooks', () => {
    render('<aside><div class="dashboard-changelog" id="a"></div></aside>');

    assert.deepEqual(
      findChangelogWidgets(document, null).map((element) => element.id),
      ['a'],
    );
  });

  it('takes the largest ancestor of changelog links that holds only blog links', () => {
    render(`
      <div class="sidebar" id="sidebar">
        <a href="https://github.com/octo/repo">Repo</a>
        <section id="card">
          <h2>Latest changes</h2>
          <ul>
            <li><a href="https://github.blog/changelog/2026-11-20-a">A</a></li>
            <li><a href="https://github.blog/changelog/2026-11-21-b">B</a></li>
          </ul>
          <a href="https://github.blog/changelog/">View changelog</a>
        </section>
      </div>`);

    assert.deepEqual(
      findChangelogWidgets(document, null).map((element) => element.id),
      ['card'],
    );
  });

  it('stops at the first landmark and never takes a container of other page parts', () => {
    render(`
      <div id="page">
        <main id="main"></main>
        <div id="column"><aside id="outer"><section id="card">
          <a href="https://github.blog/changelog/x">X</a>
        </section></aside></div>
      </div>
      <div id="wrapper"><div id="inner"><a href="https://github.blog/changelog/y">Y</a></div>
        <header>No links yet</header></div>`);

    assert.deepEqual(
      findChangelogWidgets(document, null).map((element) => element.id),
      ['card', 'inner'],
    );
  });

  it('stops at main and ignores matches inside the excluded root', () => {
    render(`
      <main id="main"><a id="link" href="https://github.blog/changelog/x">X</a></main>
      <div id="ghx-root"><div class="dashboard-changelog"></div></div>`);

    const root = document.getElementById('ghx-root');
    assert.deepEqual(
      findChangelogWidgets(document, root).map((element) => element.id),
      ['link'],
    );
  });

  it('returns nothing without changelog markup', () => {
    render('<main><a href="https://github.com/">Home</a><a>no href</a></main>');

    assert.deepEqual(findChangelogWidgets(document, null), []);
  });
});

describe('findHeaderSlot', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  function render(globalBar: string): void {
    document.body.innerHTML = `
      <header class="AppHeader" role="banner"><div class="AppHeader-globalBar">${globalBar}</div>
      </header>`;
  }

  const START = '<div class="AppHeader-globalBar-start" id="start"><a id="logo"></a></div>';

  // Mirrors the React header observed on github.com in November 2026.
  const GLOBAL_NAV = `
    <header class="GlobalNav appHeader__6OmbvL prc-Stack-Stack-UQ9k6"><div>
      <div class="left__VBt0gv" id="left"><a id="home"></a></div>
      <div class="center__f1ujjY" id="center">
        <nav class="contextRegion__Wb1-GR" id="context"></nav>
        <div class="searchButtonGroup__lia0l0 prc-ButtonGroup-ButtonGroup-vFUrY" id="search"></div>
      </div>
      <div class="right__5m36ST rightWithResponsiveCreateButton__JePGAt" id="right">
        <div id="actions"></div>
      </div>
    </div></header>`;

  it('uses the spot in front of the search button of the React header', () => {
    document.body.innerHTML = GLOBAL_NAV;

    assert.deepEqual(findHeaderSlot(document, null), {
      parent: document.getElementById('center'),
      before: document.getElementById('search'),
    });
  });

  it('falls back to the right region of the React header', () => {
    document.body.innerHTML = GLOBAL_NAV;
    document.getElementById('search')?.remove();

    assert.deepEqual(findHeaderSlot(document, null), {
      parent: document.getElementById('right'),
      before: document.getElementById('actions'),
    });
    const pins = document.createElement('span');
    document.getElementById('center')?.append(pins);
    assert.equal(isInHeaderSlot(pins), true);
  });

  it('prefers the spot in front of the search', () => {
    render(`${START}<div class="AppHeader-globalBar-end" id="end">
      <div id="other"></div><div class="AppHeader-search" id="search"></div></div>`);

    assert.deepEqual(findHeaderSlot(document, null), {
      parent: document.getElementById('end'),
      before: document.getElementById('search'),
    });
  });

  it('prepends to the end part without search and skips the excluded element', () => {
    render(`${START}<div class="AppHeader-globalBar-end" id="end">
      <div id="own"></div><div id="actions"></div></div>`);
    const own = document.getElementById('own');

    assert.equal(findHeaderSlot(document, own)?.before, document.getElementById('actions'));
    assert.equal(findHeaderSlot(document, null)?.before, own);

    render(`${START}<div class="AppHeader-globalBar-end" id="end"></div>`);
    assert.deepEqual(findHeaderSlot(document, null), {
      parent: document.getElementById('end'),
      before: null,
    });
  });

  it('appends to the start part when the end part is missing', () => {
    render(START);

    assert.deepEqual(findHeaderSlot(document, null), {
      parent: document.getElementById('start'),
      before: null,
    });
  });

  it('fails open on unknown header markup', () => {
    document.body.innerHTML = `
      <header role="banner"><div class="AppHeader-globalBar-end"></div></header>
      <div class="AppHeader-globalBar-start"></div>`;

    assert.equal(findHeaderSlot(document, null), null);
  });

  it('tells whether an element sits in a slot', () => {
    render(`${START}<div class="AppHeader-globalBar-end"><span id="pins"></span></div>`);
    const pins = document.getElementById('pins');
    assert.ok(pins !== null);
    assert.equal(isInHeaderSlot(pins), true);

    pins.remove();
    assert.equal(isInHeaderSlot(pins), false);

    document.body.append(pins);
    assert.equal(isInHeaderSlot(pins), false);
  });
});

describe('isRepositoryCodePath', () => {
  it('accepts repository home and tree pages', () => {
    assert.equal(isRepositoryCodePath('/octo/repo'), true);
    assert.equal(isRepositoryCodePath('/octo/repo/'), true);
    assert.equal(isRepositoryCodePath('/octo/repo/tree/main'), true);
    assert.equal(isRepositoryCodePath('/octo/repo/tree/feature/x/src'), true);
  });

  it('rejects other pages', () => {
    assert.equal(isRepositoryCodePath('/'), false);
    assert.equal(isRepositoryCodePath('/octo'), false);
    assert.equal(isRepositoryCodePath('/octo/repo/blob/main/a.ts'), false);
    assert.equal(isRepositoryCodePath('/octo/repo/tree'), false);
    assert.equal(isRepositoryCodePath('/octo/repo/pulls'), false);
    assert.equal(isRepositoryCodePath('/orgs/octo'), false);
    assert.equal(isRepositoryCodePath('/settings/profile'), false);
    assert.equal(isRepositoryCodePath('/Marketplace/actions'), false);
  });
});

describe('file list', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  it('finds both name cells of every row', () => {
    renderFileList(document, [{ name: 'src', kind: 'directory' }, { name: 'a.ts' }], {
      parentRow: true,
    });

    const cells = findFileListCells(document);
    assert.equal(cells.length, 4);
    assert.ok(cells.every((cell) => cell.classList.contains('react-directory-filename-column')));
  });

  it('includes the root itself and finds cells by the table label as fallback', () => {
    document.body.innerHTML = `
      <table aria-labelledby="folders-and-files"><tr><td><div id="cell">
        <svg class="octicon octicon-file"></svg><a href="/o/r/blob/main/x.md">x.md</a>
      </div></td></tr></table>`;
    const cell = document.getElementById('cell');
    assert.ok(cell !== null);

    assert.deepEqual(findFileListCells(cell), [cell]);
    assert.deepEqual(findFileListCells(document), [cell]);
    assert.equal(readFileListEntry(cell)?.path, '/o/r/blob/main/x.md');

    document.body.innerHTML = '<main><table><tr><td><div></div></td></tr></table></main>';
    assert.deepEqual(findFileListCells(document), []);
  });

  it('maps mutated nodes to their cell', () => {
    renderFileList(document, [{ name: 'a.ts' }]);
    const link = document.querySelector('.react-directory-row-name-cell-large-screen a');
    assert.ok(link !== null);
    const cell = link.closest('.react-directory-filename-column');

    assert.equal(fileListCellOf(link), cell);
    assert.equal(fileListCellOf(link.firstChild ?? link), cell);
    assert.equal(fileListCellOf(document.body), null);
    assert.equal(fileListCellOf(document), null);
  });

  it('reads icon and decoded path of file cells', () => {
    renderFileList(document, [
      { name: 'a b.ts', href: '/octo/repo/blob/main/.github/a%20b.ts?plain=1#L1' },
    ]);
    const [cell] = findFileListCells(document);
    assert.ok(cell !== undefined);

    const entry = readFileListEntry(cell);
    assert.equal(entry?.path, '/octo/repo/blob/main/.github/a b.ts');
    assert.equal(entry?.icon, cell.querySelector('svg.octicon-file'));
  });

  it('keeps undecodable paths as they are', () => {
    renderFileList(document, [{ name: 'x', href: '/octo/repo/blob/main/100%.md' }]);
    const [cell] = findFileListCells(document);
    assert.ok(cell !== undefined);

    assert.equal(readFileListEntry(cell)?.path, '/octo/repo/blob/main/100%.md');
  });

  it('skips folders, submodules, symlinks and cells without link', () => {
    renderFileList(document, [
      { name: 'src', kind: 'directory' },
      { name: 'vendor', kind: 'submodule' },
      { name: 'link.md', kind: 'symlink' },
      { name: 'plain.md', href: null },
    ]);

    assert.deepEqual(findFileListCells(document).map(readFileListEntry), Array(8).fill(null));
  });
});
