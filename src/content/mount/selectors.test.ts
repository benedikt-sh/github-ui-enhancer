import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { renderPage } from './github-page.fixture.ts';
import {
  findChangelogWidgets,
  findMountPoint,
  isLoggedIn,
  isStartPath,
  pageLogin,
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
