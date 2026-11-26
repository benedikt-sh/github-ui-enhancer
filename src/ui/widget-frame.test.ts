import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { h } from './dom.ts';
import { iconButton } from './forms.ts';
import { widgetFrame } from './widget-frame.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('widgetFrame', () => {
  it('renders a labeled section with header and empty body', () => {
    const frame = widgetFrame({ title: 'Review requests' });
    const heading = frame.root.querySelector('h2');

    assert.equal(frame.root.tagName, 'SECTION');
    assert.equal(frame.root.className, 'ghx-widget');
    assert.equal(frame.root.getAttribute('aria-labelledby'), heading?.id);
    assert.equal(heading?.textContent, 'Review requests');
    assert.equal(heading?.querySelector('svg'), null);
    assert.equal(frame.root.querySelector<HTMLElement>('.ghx-counter')?.hidden, true);
    assert.equal(frame.root.querySelector<HTMLElement>('.ghx-widget__subtitle')?.hidden, true);
    assert.equal(frame.body.childNodes.length, 0);
    assert.equal(frame.actions.childNodes.length, 0);
    assert.equal(frame.header.parentElement, frame.root);
  });

  it('renders icon, subtitle, count, actions, body and extra classes', () => {
    const action = iconButton({ icon: 'sync', label: 'Refresh' });
    const frame = widgetFrame({
      title: 'Runs',
      icon: 'workflow',
      subtitle: 'octo/repo',
      count: 0,
      actions: [action],
      body: h('p', null, 'content'),
      className: 'ghx-widget--wide',
    });
    const count = frame.root.querySelector<HTMLElement>('.ghx-counter');
    const subtitle = frame.root.querySelector<HTMLElement>('.ghx-widget__subtitle');

    assert.ok(frame.root.classList.contains('ghx-widget--wide'));
    assert.ok(frame.root.querySelector('h2 .ghx-icon--workflow'));
    assert.equal(count?.hidden, false);
    assert.equal(count?.textContent, '0');
    assert.equal(subtitle?.hidden, false);
    assert.equal(subtitle?.textContent, 'octo/repo');
    assert.equal(frame.actions.firstChild, action);
    assert.equal(frame.body.textContent, 'content');
  });

  it('updates title, subtitle, count and body', () => {
    const frame = widgetFrame({ title: 'Old', subtitle: 'sub', count: 3 });
    const count = frame.root.querySelector<HTMLElement>('.ghx-counter');
    const subtitle = frame.root.querySelector<HTMLElement>('.ghx-widget__subtitle');

    frame.setTitle('New <b>title</b>');
    frame.setCount(12);
    frame.setSubtitle(null);
    frame.setBody('a', h('span', null, 'b'));

    const title = frame.root.querySelector('.ghx-widget__title-text');
    assert.equal(title?.textContent, 'New <b>title</b>');
    assert.equal(frame.root.querySelector('b'), null);
    assert.equal(count?.textContent, '12');
    assert.equal(subtitle?.hidden, true);
    assert.equal(subtitle?.textContent, '');
    assert.equal(frame.body.innerHTML, 'a<span>b</span>');

    frame.setCount(null);
    frame.setSubtitle('again');
    frame.setBody();

    assert.equal(count?.hidden, true);
    assert.equal(subtitle?.textContent, 'again');
    assert.equal(frame.body.childNodes.length, 0);
  });

  it('gives each frame its own title id', () => {
    const first = widgetFrame({ title: 'a' }).root.getAttribute('aria-labelledby');
    const second = widgetFrame({ title: 'b' }).root.getAttribute('aria-labelledby');

    assert.notEqual(first, second);
  });
});
