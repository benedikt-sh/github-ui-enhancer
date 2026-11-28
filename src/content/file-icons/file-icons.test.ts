import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { fileListRow, renderFileList } from './file-list.fixture.ts';
import {
  createFileIcons,
  createIcon,
  ICON_ATTRIBUTE,
  ICON_CLASS,
  REPLACED_ATTRIBUTE,
} from './file-icons.ts';

const REPO = 'https://github.com/octo/repo';

function nextMutation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Icon ids of the large screen cells in row order, `-` where GitHub's icon stays. */
function shown(): string[] {
  return [...document.querySelectorAll('.react-directory-row-name-cell-large-screen')].map(
    (cell) => {
      const column = cell.firstElementChild;
      const ours = column?.querySelector(`:scope > [${ICON_ATTRIBUTE}]`);
      const github = column?.querySelector(':scope > svg.octicon');
      const hidden = github?.hasAttribute(REPLACED_ATTRIBUTE) === true;
      assert.equal(ours !== null && ours !== undefined, hidden, 'replaced icons are hidden');
      return ours?.getAttribute(ICON_ATTRIBUTE) ?? '-';
    },
  );
}

function untouched(): boolean {
  return document.querySelector(`[${ICON_ATTRIBUTE}], [${REPLACED_ATTRIBUTE}]`) === null;
}

function largeCell(row: number): Element {
  const cell = document.querySelectorAll(
    '.react-directory-row-name-cell-large-screen .react-directory-filename-column',
  )[row];
  assert.ok(cell !== undefined);
  return cell;
}

describe('createFileIcons', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom(REPO);
  });
  after(() => dom.cleanup());
  beforeEach(() => {
    document.body.innerHTML = '';
    dom.window.happyDOM.setURL(REPO);
  });

  it('replaces the icons of known files in both cells and restores them on stop', () => {
    renderFileList(document, [
      { name: 'src', kind: 'directory' },
      { name: '.gitignore' },
      { name: 'package.json' },
      { name: 'notes.txt' },
      { name: 'vendor', kind: 'submodule' },
    ]);
    const icons = createFileIcons({ document, window });

    icons.start();
    icons.start();
    assert.deepEqual(shown(), ['-', 'git', 'npm', '-', '-']);
    assert.equal(document.querySelectorAll(`.${ICON_CLASS}`).length, 4);

    icons.stop();
    icons.stop();
    assert.equal(untouched(), true);
  });

  it('puts the icon right before the hidden GitHub icon', () => {
    renderFileList(document, [{ name: 'index.ts' }]);
    const icons = createFileIcons({ document, window });
    icons.start();

    const [ours, github] = [...largeCell(0).children];
    assert.equal(ours?.getAttribute(ICON_ATTRIBUTE), 'typescript');
    assert.equal(github?.classList.contains('octicon-file'), true);
    icons.stop();
  });

  it('handles rows rendered later and settles without further changes', async () => {
    const icons = createFileIcons({ document, window });
    icons.start();

    renderFileList(document, [{ name: 'README.md' }], { parentRow: true });
    await nextMutation();
    assert.deepEqual(shown(), ['markdown']);

    const holder = document.createElement('div');
    holder.innerHTML = `<table><tbody>${fileListRow({ name: 'Dockerfile' }, 9)}</tbody></table>`;
    const row = holder.querySelector('tr');
    assert.ok(row !== null);
    document.querySelector('tbody')?.append(row);
    await nextMutation();
    await nextMutation();
    assert.deepEqual(shown(), ['markdown', 'docker']);
    assert.equal(document.querySelectorAll(`.${ICON_CLASS}`).length, 4);
    icons.stop();
  });

  it('follows rows that React reuses for other files', async () => {
    renderFileList(document, [{ name: 'package.json' }]);
    const icons = createFileIcons({ document, window });
    icons.start();
    const link = largeCell(0).querySelector('a');
    assert.ok(link !== null);

    link.setAttribute('href', '/octo/repo/blob/main/yarn.lock');
    await nextMutation();
    assert.deepEqual(shown(), ['yarn']);

    link.setAttribute('href', '/octo/repo/blob/main/notes.txt');
    await nextMutation();
    assert.deepEqual(shown(), ['-']);

    link.setAttribute('href', '/octo/repo/blob/main/go.mod');
    await nextMutation();
    assert.deepEqual(shown(), ['go']);
    icons.stop();
  });

  it('follows text changes inside a cell', async () => {
    renderFileList(document, [{ name: 'a.ts' }]);
    const icons = createFileIcons({ document, window });
    icons.start();
    const cell = largeCell(0);
    const link = cell.querySelector('a');
    assert.ok(link !== null);

    const text = link.firstChild;
    assert.ok(text instanceof Text);
    // A text change alone keeps the icon, the href decides.
    text.data = 'b.ts';
    await nextMutation();
    assert.deepEqual(shown(), ['typescript']);
    icons.stop();
  });

  it('moves the icon when React replaces the GitHub icon', async () => {
    renderFileList(document, [{ name: 'main.go' }]);
    const icons = createFileIcons({ document, window });
    icons.start();
    const cell = largeCell(0);
    const old = cell.querySelector('svg.octicon-file');
    assert.ok(old !== null);

    const fresh = old.cloneNode(true);
    assert.ok(fresh instanceof Element);
    fresh.removeAttribute(REPLACED_ATTRIBUTE);
    old.remove();
    cell.append(fresh);
    await nextMutation();

    assert.deepEqual(shown(), ['go']);
    assert.equal(cell.querySelectorAll(`[${ICON_ATTRIBUTE}]`).length, 1);
    assert.equal(fresh.previousElementSibling?.getAttribute(ICON_ATTRIBUTE), 'go');
    icons.stop();
  });

  it('removes the icon when a row turns into a folder', async () => {
    renderFileList(document, [{ name: 'Makefile' }]);
    const icons = createFileIcons({ document, window });
    icons.start();
    assert.deepEqual(shown(), ['gnu']);

    const github = largeCell(0).querySelector('svg.octicon');
    github?.setAttribute('class', 'octicon octicon-file-directory-fill icon-directory');
    await nextMutation();

    assert.deepEqual(shown(), ['-']);
    icons.stop();
  });

  it('uses the path for workflow files', () => {
    dom.window.happyDOM.setURL(`${REPO}/tree/main/.github/workflows`);
    renderFileList(document, [
      { name: 'ci.yml', href: '/octo/repo/blob/main/.github/workflows/ci.yml' },
      { name: 'README.md', href: '/octo/repo/blob/main/.github/workflows/README.md' },
    ]);
    const icons = createFileIcons({ document, window });
    icons.start();

    assert.deepEqual(shown(), ['githubactions', 'markdown']);
    icons.stop();
  });

  it('restores everything when navigating away and applies again on return', async () => {
    renderFileList(document, [{ name: 'Cargo.toml' }]);
    const icons = createFileIcons({ document, window });
    icons.start();
    assert.deepEqual(shown(), ['rust']);

    dom.window.happyDOM.setURL(`${REPO}/blob/main/Cargo.toml`);
    document.body.append(document.createElement('div'));
    await nextMutation();
    assert.equal(untouched(), true);

    document.body.append(document.createElement('div'));
    await nextMutation();
    assert.equal(untouched(), true);

    dom.window.happyDOM.setURL(REPO);
    renderFileList(document, [{ name: 'Cargo.toml' }]);
    await nextMutation();
    assert.deepEqual(shown(), ['rust']);
    icons.stop();
  });

  it('does nothing outside repository code pages', () => {
    dom.window.happyDOM.setURL('https://github.com/octo/repo/pulls');
    renderFileList(document, [{ name: 'package.json' }]);
    const icons = createFileIcons({ document, window });

    icons.start();
    assert.equal(untouched(), true);
    icons.stop();
  });

  it('fails open on unknown markup and ignores unrelated changes', async () => {
    document.body.innerHTML = `
      <table><tr><td><div><svg class="octicon octicon-file"></svg>
        <a href="/octo/repo/blob/main/package.json">package.json</a>
      </div></td></tr></table>`;
    const icons = createFileIcons({ document, window });
    icons.start();
    assert.equal(untouched(), true);

    document.body.append(document.createElement('p'), document.createTextNode('text'));
    await nextMutation();
    assert.equal(untouched(), true);
    icons.stop();
  });
});

describe('createIcon', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom(REPO);
  });
  after(() => dom.cleanup());

  it('draws brand icons in their color with the tone class', () => {
    const icon = createIcon(document, 'javascript');

    assert.equal(icon.getAttribute('class'), `${ICON_CLASS} ${ICON_CLASS}--darken`);
    assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    assert.equal(icon.style.getPropertyValue('--ghx-file-icon-color'), '#F7DF1E');
    assert.equal(icon.querySelectorAll('path').length, 1);
  });

  it('draws icons without color in the text color', () => {
    const icon = createIcon(document, 'license');

    assert.equal(icon.getAttribute('class'), `${ICON_CLASS} ${ICON_CLASS}--mono`);
    assert.equal(icon.getAttribute('viewBox'), '0 0 16 16');
    assert.equal(icon.style.getPropertyValue('--ghx-file-icon-color'), '');
  });
});
