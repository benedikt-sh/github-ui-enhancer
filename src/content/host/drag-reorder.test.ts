import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { h } from '../../ui/dom.ts';
import {
  AUTO_SCROLL_INTERVAL_MS,
  createDragReorder,
  DRAGGING_CLASS,
  DROP_AFTER_CLASS,
  DROP_BEFORE_CLASS,
  GRID_DRAGGING_CLASS,
} from './drag-reorder.ts';
import type { DragReorder, DragReorderOptions } from './drag-reorder.ts';
import { createFakeTime } from './host.fixture.ts';
import type { FakeTime } from './host.fixture.ts';
import { HANDLE_CLASS } from './instance-item.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

afterEach(() => {
  document.body.replaceChildren();
});

after(async () => {
  await dom.cleanup();
});

function setBox(element: Element, left: number, top: number, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
    }),
  });
}

interface PointerInit {
  readonly x?: number;
  readonly y?: number;
  readonly id?: number;
  readonly button?: number;
  readonly primary?: boolean;
  readonly buttons?: number;
}

function pointer(target: EventTarget, type: string, init: PointerInit = {}): Event {
  const event = new dom.window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    pointerId: init.id ?? 1,
    button: init.button ?? 0,
    isPrimary: init.primary ?? true,
    buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
  }) as unknown as Event;
  target.dispatchEvent(event);
  return event;
}

function key(name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

function item(id: string): HTMLElement {
  return h(
    'section',
    { dataset: { instanceId: id } },
    h(
      'header',
      { className: HANDLE_CLASS },
      h('span', { className: 'title' }, `Title ${id}`),
      h('button', { type: 'button' }, 'Menu'),
    ),
    h('div', { className: 'body' }, 'content'),
  );
}

interface Setup {
  readonly drag: DragReorder;
  readonly grid: HTMLElement;
  readonly items: Record<'a' | 'b' | 'c', HTMLElement>;
  readonly drops: string[];
  readonly time: FakeTime;
  readonly handle: (id: 'a' | 'b' | 'c') => HTMLElement;
}

/*
 * a (half) | b (half)    y 100-200
 * c (full)               y 220-320
 */
function setup(overrides: Partial<DragReorderOptions> = {}): Setup {
  const items = { a: item('a'), b: item('b'), c: item('c') };
  const grid = h('div', null, items.a, items.b, h('p', null, 'not an item'), items.c);
  document.body.append(grid);
  setBox(grid, 0, 100, 1000, 220);
  setBox(items.a, 0, 100, 490, 100);
  setBox(items.b, 510, 100, 490, 100);
  setBox(items.c, 0, 220, 1000, 100);
  const drops: string[] = [];
  const time = createFakeTime();
  const drag = createDragReorder({
    grid,
    timers: time,
    canDrag: () => true,
    onDrop: (id, targetId, side) => drops.push(`${id} ${side} ${targetId}`),
    ...overrides,
  });
  const handle = (id: 'a' | 'b' | 'c'): HTMLElement =>
    items[id].querySelector<HTMLElement>(`.${HANDLE_CLASS}`) ?? items[id];
  return { drag, grid, items, drops, time, handle };
}

/** Presses on the handle of `id` and moves past the threshold. */
function startDrag(context: Setup, id: 'a' | 'b' | 'c', x = 50, y = 150): HTMLElement {
  const handle = context.handle(id);
  pointer(handle, 'pointerdown', { x, y });
  pointer(handle, 'pointermove', { x: x + 10, y });
  return handle;
}

const dropClasses = (element: HTMLElement): string[] =>
  [DROP_BEFORE_CLASS, DROP_AFTER_CLASS].filter((name) => element.classList.contains(name));

describe('createDragReorder', () => {
  it('treats a press without movement as a click', () => {
    const context = setup();
    const handle = context.handle('a');
    pointer(handle, 'pointerdown', { x: 50, y: 150 });
    pointer(handle, 'pointermove', { x: 52, y: 152 });
    assert.equal(context.drag.dragging, false);
    assert.equal(context.grid.classList.contains(GRID_DRAGGING_CLASS), false);
    pointer(handle, 'pointerup', { x: 52, y: 152 });
    assert.deepEqual(context.drops, []);
    pointer(handle, 'pointermove', { x: 300, y: 150 });
    assert.equal(context.drag.dragging, false);
  });

  it('lifts the item and drops it on another half width item', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    assert.equal(context.drag.dragging, true);
    assert.equal(context.grid.classList.contains(GRID_DRAGGING_CLASS), true);
    assert.equal(context.items.a.classList.contains(DRAGGING_CLASS), true);
    assert.equal(handle.hasPointerCapture(1), true);

    const move = pointer(handle, 'pointermove', { x: 900, y: 150 });
    assert.equal(move.defaultPrevented, true);
    assert.deepEqual(dropClasses(context.items.b), [DROP_AFTER_CLASS]);

    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, ['a after b']);
    assert.equal(context.drag.dragging, false);
    assert.equal(context.grid.classList.contains(GRID_DRAGGING_CLASS), false);
    assert.equal(context.items.a.classList.contains(DRAGGING_CLASS), false);
    assert.deepEqual(dropClasses(context.items.b), []);
    assert.equal(handle.hasPointerCapture(1), false);
  });

  it('moves the indicator between items', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    pointer(handle, 'pointermove', { x: 500, y: 300 });
    assert.deepEqual(dropClasses(context.items.c), [DROP_AFTER_CLASS]);
    pointer(handle, 'pointermove', { x: 500, y: 230 });
    assert.deepEqual(dropClasses(context.items.c), [DROP_BEFORE_CLASS]);
    pointer(handle, 'pointermove', { x: 600, y: 120 });
    assert.deepEqual(dropClasses(context.items.c), []);
    assert.deepEqual(dropClasses(context.items.b), [], 'before b keeps a where it is');
    pointer(handle, 'pointerup', { x: 500, y: 230 });
    assert.deepEqual(context.drops, ['a before c']);
  });

  it('drops a later item before an earlier one', () => {
    const context = setup();
    const handle = startDrag(context, 'c', 50, 270);
    pointer(handle, 'pointerup', { x: 20, y: 120 });
    assert.deepEqual(context.drops, ['c before a']);
  });

  it('changes nothing when dropped on its own position', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    pointer(handle, 'pointermove', { x: 400, y: 150 });
    assert.deepEqual(
      Object.values(context.items).flatMap((element) => dropClasses(element)),
      [],
    );
    pointer(handle, 'pointerup', { x: 400, y: 150 });
    assert.deepEqual(context.drops, []);
  });

  it('cancels with Escape and ignores other keys', () => {
    const context = setup();
    const handle = context.handle('a');
    pointer(handle, 'pointerdown', { x: 50, y: 150 });
    assert.equal(key('Escape').defaultPrevented, false, 'a pending press does not take Escape');
    pointer(handle, 'pointermove', { x: 900, y: 150 });
    assert.equal(key('Enter').defaultPrevented, false);
    assert.equal(context.drag.dragging, true);
    assert.equal(key('Escape').defaultPrevented, true);
    assert.equal(context.drag.dragging, false);
    assert.deepEqual(dropClasses(context.items.b), []);
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, []);
  });

  it('ends when a move arrives without a pressed button', () => {
    const context = setup();
    const handle = context.handle('a');
    pointer(handle, 'pointerdown', { x: 50, y: 150 });
    pointer(handle, 'pointermove', { x: 900, y: 150, buttons: 0 });
    assert.equal(context.drag.dragging, false);
    pointer(handle, 'pointermove', { x: 900, y: 150 });
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.equal(context.drag.dragging, false);
    assert.deepEqual(context.drops, []);
  });

  it('cancels when the browser cancels the pointer', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    pointer(handle, 'pointercancel', { id: 2 });
    assert.equal(context.drag.dragging, true, 'other pointers are ignored');
    pointer(handle, 'pointercancel');
    assert.equal(context.drag.dragging, false);
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, []);
  });

  it('ignores other pointers while dragging', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    pointer(context.handle('b'), 'pointerdown', { id: 2, x: 600, y: 150 });
    pointer(handle, 'pointermove', { id: 2, x: 500, y: 300 });
    pointer(handle, 'pointerup', { id: 2, x: 500, y: 300 });
    assert.equal(context.drag.dragging, true);
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, ['a after b']);
  });

  it('only starts on the handle with the primary button and outside of controls', () => {
    const calls: string[] = [];
    const context = setup({
      canDrag: (id) => {
        calls.push(id);
        return id !== 'b';
      },
    });
    const tryDrag = (target: EventTarget, init: PointerInit = {}): boolean => {
      pointer(target, 'pointerdown', { x: 50, y: 150, ...init });
      pointer(target, 'pointermove', { x: 300, y: 150, ...init });
      const dragging = context.drag.dragging;
      context.drag.cancel();
      return dragging;
    };
    const handleA = context.handle('a');
    assert.equal(tryDrag(handleA, { button: 2 }), false);
    assert.equal(tryDrag(handleA, { primary: false }), false);
    assert.equal(tryDrag(handleA.querySelector('button') ?? handleA), false);
    assert.equal(tryDrag(context.items.a.querySelector('.body') ?? handleA), false);
    assert.equal(tryDrag(handleA.querySelector('.title')?.firstChild ?? handleA), false);
    assert.equal(tryDrag(context.handle('b')), false);
    assert.deepEqual(calls, ['b']);
    assert.equal(tryDrag(handleA.querySelector('.title') ?? handleA), true);
  });

  it('ignores handles that do not belong to a grid item', () => {
    const context = setup();
    const nested = h('div', { className: HANDLE_CLASS }, 'nested');
    context.items.a.querySelector('.body')?.append(nested);
    const stray = h('div', { className: HANDLE_CLASS });
    context.grid.append(stray);
    for (const target of [nested, stray]) {
      pointer(target, 'pointerdown', { x: 50, y: 150 });
      pointer(target, 'pointermove', { x: 300, y: 150 });
      assert.equal(context.drag.dragging, false);
    }
  });

  it('keeps dragging when pointer capture fails', () => {
    const context = setup();
    const handle = context.handle('a');
    Object.defineProperty(handle, 'setPointerCapture', {
      value: () => {
        throw new Error('NotFoundError');
      },
    });
    startDrag(context, 'a');
    assert.equal(context.drag.dragging, true);
    pointer(document.body, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, ['a after b']);
  });

  it('scrolls near the viewport edges until the pointer leaves them', () => {
    const context = setup();
    const scrolls: number[] = [];
    const original = window.scrollBy;
    const record = (_x: number, y: number): void => {
      scrolls.push(y);
    };
    Object.defineProperty(window, 'scrollBy', { configurable: true, value: record });
    try {
      const handle = startDrag(context, 'a');
      assert.equal(context.time.pending(), 0);
      pointer(handle, 'pointermove', { x: 500, y: window.innerHeight - 1 });
      pointer(handle, 'pointermove', { x: 500, y: window.innerHeight - 2 });
      assert.equal(context.time.pending(), 1, 'one scroll loop at a time');
      context.time.advance(AUTO_SCROLL_INTERVAL_MS * 3);
      assert.equal(scrolls.length, 3);
      assert.ok(scrolls.every((step) => step > 0));
      // The rects move while scrolling, the target follows them.
      setBox(context.items.c, 0, 120, 1000, 100);
      context.time.advance(AUTO_SCROLL_INTERVAL_MS);
      assert.deepEqual(dropClasses(context.items.c), [DROP_AFTER_CLASS]);

      pointer(handle, 'pointermove', { x: 500, y: 0 });
      context.time.advance(AUTO_SCROLL_INTERVAL_MS);
      assert.ok((scrolls.at(-1) ?? 0) < 0);

      pointer(handle, 'pointermove', { x: 500, y: 400 });
      const count = scrolls.length;
      context.time.advance(AUTO_SCROLL_INTERVAL_MS * 3);
      assert.equal(scrolls.length, count, 'the pending step finds the pointer away');
      assert.equal(context.time.pending(), 0);

      pointer(handle, 'pointermove', { x: 500, y: 0 });
      assert.equal(context.time.pending(), 1);
      pointer(handle, 'pointerup', { x: 500, y: 0 });
      assert.equal(context.time.pending(), 0);
    } finally {
      Object.defineProperty(window, 'scrollBy', { configurable: true, value: original });
    }
  });

  it('does not scroll documents without a window', () => {
    const detached = document.implementation.createHTMLDocument('detached');
    const grid = detached.createElement('div');
    const element = detached.createElement('section');
    element.dataset['instanceId'] = 'a';
    const handle = detached.createElement('header');
    handle.className = HANDLE_CLASS;
    element.append(handle);
    grid.append(element);
    detached.body.append(grid);
    const time = createFakeTime();
    const drag = createDragReorder({
      grid,
      timers: time,
      canDrag: () => true,
      onDrop: () => undefined,
    });
    pointer(handle, 'pointerdown', { x: 10, y: 0 });
    pointer(handle, 'pointermove', { x: 30, y: 0 });
    assert.equal(drag.dragging, true);
    assert.equal(time.pending(), 0);
    drag.dispose();
  });

  it('cancels a running drag on request', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    pointer(handle, 'pointermove', { x: 900, y: 150 });
    context.drag.cancel();
    assert.equal(context.drag.dragging, false);
    assert.deepEqual(dropClasses(context.items.b), []);
    context.drag.cancel();
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    assert.deepEqual(context.drops, []);
  });

  it('removes every listener on dispose', () => {
    const context = setup();
    const handle = startDrag(context, 'a');
    context.drag.dispose();
    assert.equal(context.drag.dragging, false);
    assert.equal(context.items.a.classList.contains(DRAGGING_CLASS), false);
    pointer(handle, 'pointerup', { x: 900, y: 150 });
    startDrag(context, 'a');
    assert.equal(context.drag.dragging, false);
    assert.deepEqual(context.drops, []);
  });
});
