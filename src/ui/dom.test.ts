import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { classNames, h, safeUrl, svg, SVG_NAMESPACE, uniqueId } from './dom.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('h', () => {
  it('creates an element of the given tag with attributes', () => {
    const link = h('a', { href: 'https://github.com/', tabindex: 0, hidden: true, title: null });

    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), 'https://github.com/');
    assert.equal(link.getAttribute('tabindex'), '0');
    assert.equal(link.getAttribute('hidden'), '');
    assert.equal(link.hasAttribute('title'), false);
  });

  it('leaves out false and undefined attributes', () => {
    const button = h('button', { disabled: false, 'aria-label': undefined });

    assert.equal(button.hasAttribute('disabled'), false);
    assert.equal(button.hasAttribute('aria-label'), false);
  });

  it('works without props', () => {
    assert.equal(h('div').outerHTML, '<div></div>');
    assert.equal(h('div', null, 'x').textContent, 'x');
  });

  it('joins class names and skips falsy parts', () => {
    const element = h('div', { className: ['a', false, null, undefined, ['b  c', ['d']], ''] });

    assert.equal(element.getAttribute('class'), 'a b c d');
    assert.equal(h('div', { className: false }).hasAttribute('class'), false);
  });

  it('sets dataset entries and styles', () => {
    const element = h('div', {
      dataset: { itemId: '42', skipped: undefined },
      style: { backgroundColor: 'red', '--ghx-x': '1px', color: undefined },
    });

    assert.equal(element.getAttribute('data-item-id'), '42');
    assert.equal(element.hasAttribute('data-skipped'), false);
    assert.equal(element.style.getPropertyValue('background-color'), 'red');
    assert.equal(element.style.getPropertyValue('--ghx-x'), '1px');
    assert.equal(element.style.getPropertyValue('color'), '');
  });

  it('adds event listeners', () => {
    let clicks = 0;
    const button = h('button', { on: { click: () => clicks++ } });

    button.click();
    button.click();

    assert.equal(clicks, 2);
  });

  it('appends text, numbers, nodes and nested arrays and skips empty children', () => {
    const element = h('p', null, 'a', 1, null, undefined, false, [h('b', null, 'c'), ['d']]);

    assert.equal(element.innerHTML, 'a1<b>c</b>d');
  });

  it('never parses strings as markup', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const element = h('div', { title: payload }, payload);

    assert.equal(element.children.length, 0);
    assert.equal(element.textContent, payload);
    assert.equal(element.getAttribute('title'), payload);
  });

  it('rejects unsupported attribute values', () => {
    assert.throws(() => h('div', { custom: ['x'] }), TypeError);
  });
});

describe('svg', () => {
  it('creates elements in the SVG namespace', () => {
    const root = svg(
      'svg',
      { viewBox: '0 0 16 16', className: 'icon', on: { click: () => undefined } },
      svg('path', { d: 'M0 0Z' }),
    );

    assert.equal(root.namespaceURI, SVG_NAMESPACE);
    assert.equal(root.getAttribute('viewBox'), '0 0 16 16');
    assert.equal(root.getAttribute('class'), 'icon');
    assert.equal(root.firstElementChild?.namespaceURI, SVG_NAMESPACE);
    assert.equal(svg('g').childNodes.length, 0);
  });
});

describe('classNames', () => {
  it('returns an empty string without classes', () => {
    assert.equal(classNames(), '');
    assert.equal(classNames(null, false), '');
  });
});

describe('uniqueId', () => {
  it('returns distinct ids with the given prefix', () => {
    const first = uniqueId();
    const second = uniqueId('menu');

    assert.match(first, /^ghx-\d+$/);
    assert.match(second, /^menu-\d+$/);
    assert.notEqual(first.split('-')[1], second.split('-')[1]);
  });
});

describe('safeUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(safeUrl('https://github.com/a/b'), 'https://github.com/a/b');
    assert.equal(safeUrl('http://example.com'), 'http://example.com/');
  });

  it('rejects other schemes, relative and empty values', () => {
    const values = ['javascript:alert(1)', 'data:text/html,x', '/relative', '', null, undefined];
    for (const value of values) {
      assert.equal(safeUrl(value), null, String(value));
    }
  });
});
