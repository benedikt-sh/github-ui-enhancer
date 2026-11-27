import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { renderPage } from './github-page.fixture.ts';
import { findMountPoint, isLoggedIn, isStartPath, pageLogin } from './selectors.ts';

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
