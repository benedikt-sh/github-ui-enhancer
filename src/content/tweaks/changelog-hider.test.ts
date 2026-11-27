import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createChangelogHider, HIDDEN_ATTRIBUTE } from './changelog-hider.ts';

const CARD = `
  <aside>
    <section id="card">
      <a href="https://github.blog/changelog/2026-11-20-a">A</a>
    </section>
    <a href="https://github.com/octo">Profile</a>
  </aside>`;

function nextMutation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function hidden(): string[] {
  return [...document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)].map((element) => element.id);
}

describe('createChangelogHider', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom('https://github.com/');
  });
  after(() => dom.cleanup());
  beforeEach(() => {
    document.body.innerHTML = '';
    dom.window.happyDOM.setURL('https://github.com/');
  });

  it('hides the changelog on the start page and shows it again on stop', () => {
    document.body.innerHTML = CARD;
    const hider = createChangelogHider({ document, window });

    hider.start();
    hider.start();
    assert.deepEqual(hidden(), ['card']);

    hider.stop();
    assert.deepEqual(hidden(), []);
  });

  it('hides a changelog that is rendered later', async () => {
    const hider = createChangelogHider({ document, window });
    hider.start();

    document.body.innerHTML = CARD;
    await nextMutation();

    assert.deepEqual(hidden(), ['card']);
    hider.stop();
  });

  it('leaves other pages alone and restores elements after navigating away', async () => {
    document.body.innerHTML = CARD;
    const hider = createChangelogHider({ document, window });
    hider.start();
    assert.deepEqual(hidden(), ['card']);

    dom.window.happyDOM.setURL('https://github.com/octo/repo');
    document.body.append(document.createElement('div'));
    await nextMutation();

    assert.deepEqual(hidden(), []);
    hider.stop();
  });

  it('ignores the extension root and tolerates stop before start', () => {
    document.body.innerHTML = `<div id="ghx-root"><a href="https://github.blog/changelog/x">X</a></div>`;
    const hider = createChangelogHider({ document, window });
    hider.stop();
    hider.start();

    assert.deepEqual(hidden(), []);
    hider.stop();
  });
});
