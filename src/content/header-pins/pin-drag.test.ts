import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import {
  attachPinDrag,
  DRAGGING_CLASS,
  dropIndex,
  DROP_BEFORE_CLASS,
  ITEM_DRAGGING_CLASS,
} from './pin-drag.ts';

describe('dropIndex', () => {
  it('counts the pins left of the pointer', () => {
    assert.equal(dropIndex([50, 150, 250], 10), 0);
    assert.equal(dropIndex([50, 150, 250], 160), 2);
    assert.equal(dropIndex([50, 150, 250], 999), 3);
    assert.equal(dropIndex([], 5), 0);
  });
});

describe('attachPinDrag', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  let list: HTMLElement;
  let moves: [number, number][];
  let detach: () => void;

  beforeEach(() => {
    document.body.innerHTML = `<ul id="list">
      <li data-pin-index="0"><a id="a">a</a></li>
      <li data-pin-index="1"><a id="b">b</a></li>
      <li data-pin-index="2"><a id="c">c</a></li>
      <li id="auto"><a>auto</a></li></ul>`;
    const found = document.getElementById('list');
    assert.ok(found !== null);
    list = found;
    [...list.children].forEach((item, index) => {
      item.getBoundingClientRect = () => ({ left: index * 100, width: 80 }) as DOMRect;
    });
    moves = [];
    detach = attachPinDrag({ document, list, onMove: (from, to) => moves.push([from, to]) });
  });

  function pointer(type: string, x: number, target: EventTarget = document, button = 0): void {
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 0, button, bubbles: true }));
  }

  function item(id: string): HTMLElement {
    const element = document.getElementById(id)?.parentElement;
    assert.ok(element instanceof HTMLElement);
    return element;
  }

  it('moves a pin forward and marks the drop position on the way', () => {
    pointer('pointerdown', 240, document.getElementById('c') ?? document);
    pointer('pointermove', 30);
    assert.ok(list.classList.contains(DRAGGING_CLASS));
    assert.ok(item('c').classList.contains(ITEM_DRAGGING_CLASS));
    assert.ok(item('a').classList.contains(DROP_BEFORE_CLASS));
    pointer('pointerup', 30);

    assert.deepEqual(moves, [[2, 0]]);
    assert.equal(list.classList.contains(DRAGGING_CLASS), false);
    assert.equal(item('a').classList.contains(DROP_BEFORE_CLASS), false);
    detach();
  });

  it('ignores clicks, other buttons, foreign items and unchanged positions', () => {
    pointer('pointerdown', 40, document.getElementById('a') ?? document);
    pointer('pointerup', 41);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('a')?.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'a plain click still opens the repository');

    pointer('pointerdown', 40, document.getElementById('a') ?? document, 2);
    pointer('pointerup', 300);
    pointer('pointerdown', 340, document.getElementById('auto') ?? document);
    pointer('pointerup', 10);
    pointer('pointerdown', 140, document.getElementById('b') ?? document);
    pointer('pointermove', 150);
    pointer('pointermove', 145);
    pointer('pointerup', 145);
    pointer('pointermove', 10);

    assert.deepEqual(moves, []);
    detach();
  });

  it('cancels with Escape, pointercancel and when the pin is re-rendered', () => {
    pointer('pointerdown', 40, document.getElementById('a') ?? document);
    pointer('pointermove', 300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer('pointerup', 300);

    pointer('pointerdown', 40, document.getElementById('a') ?? document);
    pointer('pointermove', 300);
    document.dispatchEvent(new Event('pointercancel'));

    pointer('pointerdown', 40, document.getElementById('a') ?? document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    item('a').remove();
    pointer('pointermove', 300);
    pointer('pointerup', 300);

    assert.deepEqual(moves, []);
    detach();
  });

  it('stops listening after dispose', () => {
    detach();
    pointer('pointerdown', 40, document.getElementById('a') ?? document);
    pointer('pointermove', 300);
    pointer('pointerup', 300);

    assert.deepEqual(moves, []);
  });
});
