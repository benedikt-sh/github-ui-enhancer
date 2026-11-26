import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { renderPage, replaceBody } from './github-page.fixture.ts';
import type { PageOptions } from './github-page.fixture.ts';
import {
  createMountController,
  MOUNT_ATTRIBUTE,
  PENDING_CLASS,
  ROOT_ID,
  VIEW_ATTRIBUTE,
} from './mount-controller.ts';
import type { MountController, MountControllerOptions } from './mount-controller.ts';

let dom: DomEnvironment;
let entered: HTMLElement[];
let left: number;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });
}

function controller(overrides: Partial<MountControllerOptions> = {}): MountController {
  return createMountController({
    document,
    window,
    onEnter: (root) => entered.push(root),
    onLeave: () => {
      left += 1;
    },
    ...overrides,
  });
}

function started(page: PageOptions = {}, overrides: Partial<MountControllerOptions> = {}) {
  renderPage(document, page);
  const mount = controller(overrides);
  mount.start();
  return mount;
}

function navigate(path: string, page: PageOptions = {}): void {
  history.pushState({}, '', path);
  renderPage(document, page);
}

function roots(): Element[] {
  return [...document.querySelectorAll(`#${ROOT_ID}`)];
}

function marked(): Element[] {
  return [...document.querySelectorAll(`[${MOUNT_ATTRIBUTE}]`)];
}

function pending(): boolean {
  return document.documentElement.classList.contains(PENDING_CLASS);
}

function assertUntouched(): void {
  assert.deepEqual(roots(), []);
  assert.deepEqual(marked(), []);
  assert.equal(document.querySelector(`[${VIEW_ATTRIBUTE}]`), null);
  assert.equal(pending(), false);
}

beforeEach(() => {
  dom = installDom('https://github.com/');
  entered = [];
  left = 0;
});

afterEach(() => dom.cleanup());

describe('initial page load', () => {
  it('mounts the root as first child of main on the logged-in start page', () => {
    const mount = started();
    const main = document.querySelector('main');

    assert.equal(mount.root, main?.firstElementChild);
    assert.equal(mount.root?.id, ROOT_ID);
    assert.deepEqual(entered, [mount.root]);
    assert.equal(main?.getAttribute(MOUNT_ATTRIBUTE), 'first-child');
    assert.equal(main?.getAttribute(VIEW_ATTRIBUTE), 'dashboard');
    assert.equal(pending(), false);
    assert.ok(document.getElementById('dashboard'), 'GitHub nodes are kept');
  });

  it('uses each fallback of the selector chain', () => {
    const cases = [
      { variant: 'role-main', container: '[role="main"]' },
      { variant: 'application-main', container: '.application-main' },
    ] as const;
    for (const { variant, container } of cases) {
      const mount = started({ variant });
      assert.equal(document.querySelector(container)?.firstElementChild, mount.root, variant);
      mount.stop();
    }
  });

  it('inserts the root after the header as last resort', () => {
    const mount = started({ variant: 'header-only' });
    const wrapper = document.querySelector('.js-header-wrapper');

    assert.equal(wrapper?.nextElementSibling, mount.root);
    assert.equal(wrapper?.parentElement?.getAttribute(MOUNT_ATTRIBUTE), 'after-header');
  });

  it('fails open without a mount point', () => {
    const mount = started({ variant: 'bare' });

    assert.equal(mount.root, null);
    assert.deepEqual(entered, []);
    assertUntouched();
  });

  it('leaves the logged-out marketing page untouched', () => {
    for (const login of ['', null]) {
      const mount = started({ login });
      assert.equal(mount.root, null);
      assertUntouched();
      mount.stop();
    }
    assert.deepEqual(entered, []);
    assert.equal(left, 0);
  });

  it('does nothing on other pages', () => {
    history.pushState({}, '', '/octocat/hello-world');
    started();

    assertUntouched();
    assert.deepEqual(entered, []);
  });
});

describe('document_start', () => {
  it('hides the page until the document is ready, then mounts', async () => {
    setReadyState('loading');
    document.documentElement.removeChild(document.body);
    const mount = controller();
    mount.start();

    assert.equal(pending(), true);
    assert.equal(mount.root, null);

    document.documentElement.appendChild(document.createElement('body'));
    renderPage(document);
    await flush();
    assert.equal(pending(), true, 'a logged-in page waits for the complete DOM');
    assert.equal(mount.root, null);

    setReadyState('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    assert.equal(pending(), false);
    assert.equal(document.querySelector('main')?.firstElementChild, mount.root);
    assert.equal(entered.length, 1);
  });

  it('reveals the marketing page as soon as the head is parsed', async () => {
    setReadyState('loading');
    document.documentElement.removeChild(document.body);
    const mount = controller();
    mount.start();
    assert.equal(pending(), true);

    document.documentElement.appendChild(document.createElement('body'));
    renderPage(document, { login: '' });
    await flush();

    assertUntouched();
    assert.equal(mount.root, null);
  });

  it('stops hiding after the timeout and still mounts later', async () => {
    setReadyState('loading');
    const mount = started({}, { timeoutMs: 5 });
    assert.equal(pending(), true);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(pending(), false);
    assert.deepEqual(entered, []);

    setReadyState('complete');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    assert.deepEqual(roots(), entered);
    assert.equal(mount.root, entered[0]);
  });

  it('uses a default timeout', () => {
    setReadyState('loading');
    const mount = started();

    assert.equal(pending(), true);
    mount.stop();
    assert.equal(pending(), false);
  });
});

describe('soft navigation', () => {
  it('leaves when the URL changes with the next render', async () => {
    const mount = started();
    const main = document.querySelector('main');

    history.pushState({}, '', '/pulls');
    main?.append(document.createElement('div'));
    await flush();

    assert.equal(left, 1);
    assert.equal(mount.root, null);
    assertUntouched();
  });

  it('reacts to turbo events and popstate without DOM changes', () => {
    const mount = started();

    history.pushState({}, '', '/notifications');
    document.dispatchEvent(new Event('turbo:load'));
    assert.equal(left, 1);
    assertUntouched();

    history.pushState({}, '', '/');
    document.dispatchEvent(new Event('turbo:render'));
    assert.equal(entered.length, 2);

    history.pushState({}, '', '/issues');
    window.dispatchEvent(new PopStateEvent('popstate'));
    assert.equal(left, 2);
    assert.equal(mount.root, null);
  });

  it('enters again with a fresh root after navigating back', async () => {
    const mount = started();
    const first = mount.root;

    navigate('/octocat');
    await flush();
    navigate('/');
    await flush();

    assert.equal(entered.length, 2);
    assert.notEqual(entered[1], first);
    assert.equal(mount.root, entered[1]);
    assert.deepEqual(roots(), [mount.root]);
  });

  it('ignores mutations on other pages', async () => {
    history.pushState({}, '', '/pulls');
    started();

    document.body.append(document.createElement('div'));
    await flush();

    assertUntouched();
    assert.equal(left, 0);
  });

  it('removes a cached copy of the root on other pages', async () => {
    started();
    navigate('/pulls');
    await flush();

    const copy = document.createElement('div');
    copy.id = ROOT_ID;
    document.querySelector('main')?.prepend(copy);
    await flush();

    assertUntouched();
    assert.equal(left, 1);
  });
});

describe('DOM replacement on the start page', () => {
  it('re-inserts the same root without calling onEnter again', async () => {
    const mount = started();
    const root = mount.root;

    renderPage(document);
    await flush();

    assert.equal(mount.root, root);
    assert.equal(document.querySelector('main')?.firstElementChild, root);
    assert.equal(document.querySelector('main')?.getAttribute(MOUNT_ATTRIBUTE), 'first-child');
    assert.equal(entered.length, 1);
    assert.equal(left, 0);
  });

  it('replaces lifeless copies from a restored snapshot', async () => {
    const mount = started();
    mount.root?.append('live content');

    replaceBody(document);
    await flush();

    assert.deepEqual(roots(), [mount.root]);
    assert.equal(mount.root?.textContent, 'live content');
    assert.deepEqual(marked(), [document.querySelector('main')]);
    assert.equal(entered.length, 1);
  });

  it('re-inserts a root removed from its container', async () => {
    const mount = started();

    mount.root?.remove();
    await flush();

    assert.equal(document.querySelector('main')?.firstElementChild, mount.root);
  });

  it('marks the container again when the mark is lost', () => {
    const mount = started();
    const main = document.querySelector('main');

    main?.removeAttribute(MOUNT_ATTRIBUTE);
    document.dispatchEvent(new Event('turbo:render'));

    assert.equal(main?.getAttribute(MOUNT_ATTRIBUTE), 'first-child');
    assert.equal(main?.firstElementChild, mount.root);
    assert.equal(entered.length, 1);
  });

  it('switches to a lower selector stage when the container type changes', async () => {
    const mount = started();

    renderPage(document, { variant: 'header-only' });
    await flush();

    assert.equal(document.querySelector('.js-header-wrapper')?.nextElementSibling, mount.root);
    assert.equal(entered.length, 1);
  });

  it('fails open when the new DOM has no mount point', async () => {
    const mount = started();

    renderPage(document, { variant: 'bare' });
    await flush();

    assert.equal(mount.root, null);
    assert.equal(left, 1);
    assertUntouched();
  });

  it('leaves when the user is logged out on the start page', async () => {
    started();

    renderPage(document, { login: '' });
    await flush();

    assert.equal(left, 1);
    assertUntouched();
  });
});

describe('toggle to the original page', () => {
  it('switches the view of the container and back', () => {
    const mount = started();
    const main = document.querySelector('main');

    mount.showOriginal();
    assert.equal(mount.view, 'original');
    assert.equal(main?.getAttribute(VIEW_ATTRIBUTE), 'original');
    assert.equal(main?.firstElementChild, mount.root, 'the root stays for a way back');

    mount.showDashboard();
    assert.equal(mount.view, 'dashboard');
    assert.equal(main?.getAttribute(VIEW_ATTRIBUTE), 'dashboard');
  });

  it('keeps the view across DOM replacement', async () => {
    const mount = started();
    mount.showOriginal();

    renderPage(document);
    await flush();

    assert.equal(document.querySelector('main')?.getAttribute(VIEW_ATTRIBUTE), 'original');
  });

  it('applies the view on re-insertion when the root was detached', async () => {
    const mount = started();

    mount.root?.remove();
    mount.showOriginal();
    assert.equal(mount.view, 'original');
    await flush();

    assert.equal(document.querySelector('main')?.getAttribute(VIEW_ATTRIBUTE), 'original');
  });

  it('resets when navigating away', async () => {
    const mount = started();
    mount.showOriginal();

    navigate('/pulls');
    await flush();
    assert.equal(mount.view, 'dashboard');

    navigate('/');
    await flush();
    assert.equal(document.querySelector('main')?.getAttribute(VIEW_ATTRIBUTE), 'dashboard');
  });

  it('ignores toggles without an active root', () => {
    const mount = started({ login: '' });

    mount.showOriginal();

    assert.equal(mount.view, 'dashboard');
    assertUntouched();
  });
});

describe('start and stop', () => {
  it('removes all traces and listeners', async () => {
    const mount = started();

    mount.stop();
    assert.equal(left, 1);
    assert.equal(mount.root, null);
    assertUntouched();

    renderPage(document);
    document.dispatchEvent(new Event('turbo:load'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();

    assertUntouched();
    assert.equal(entered.length, 1);
  });

  it('ignores repeated start and stop calls', () => {
    const mount = started();

    mount.start();
    assert.equal(entered.length, 1);

    mount.stop();
    mount.stop();
    assert.equal(left, 1);
  });

  it('does not call onLeave without a root', () => {
    const mount = started({ variant: 'bare' });

    mount.stop();

    assert.equal(left, 0);
  });

  it('can be started again after stop', () => {
    const mount = started();
    mount.stop();

    mount.start();

    assert.equal(entered.length, 2);
    assert.ok(mount.root?.isConnected);
  });

  it('removes traces even when onLeave throws', () => {
    const mount = started(
      {},
      {
        onLeave: () => {
          throw new Error('host failed');
        },
      },
    );

    assert.throws(() => mount.stop(), /host failed/);
    assertUntouched();
  });
});

describe('mount.css', () => {
  const css = readFileSync(new URL('./mount.css', import.meta.url), 'utf8');

  function styledPage(page: PageOptions = {}): void {
    renderPage(document, page);
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }

  function style(selector: string): CSSStyleDeclaration {
    const element = document.querySelector(selector);
    assert.ok(element, selector);
    return getComputedStyle(element);
  }

  it('hides the original content next to the root in dashboard view only', () => {
    styledPage();
    const mount = controller();
    mount.start();

    assert.equal(style('#dashboard').display, 'none');
    assert.notEqual(style(`#${ROOT_ID}`).display, 'none');
    assert.notEqual(style('.js-header-wrapper').display, 'none');

    mount.showOriginal();
    assert.notEqual(style('#dashboard').display, 'none');
  });

  it('keeps header and portals visible when mounted after the header', () => {
    styledPage({ variant: 'header-only' });
    const portal = document.createElement('div');
    portal.id = 'overlay-portal';
    document.querySelector('[data-turbo-body]')?.append(portal);
    controller().start();

    assert.equal(style('.page').display, 'none');
    assert.equal(style('.footer').display, 'none');
    assert.notEqual(style('.js-header-wrapper').display, 'none');
    assert.notEqual(style(`#${ROOT_ID}`).display, 'none');
    assert.notEqual(style('#overlay-portal').display, 'none');
  });

  it('hides the content containers while pending', () => {
    setReadyState('loading');
    styledPage();
    controller().start();

    assert.equal(style('main').visibility, 'hidden');
    assert.equal(style('.application-main').visibility, 'hidden');
    assert.notEqual(style('.js-header-wrapper').visibility, 'hidden');
  });
});
