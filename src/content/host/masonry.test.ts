import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { h } from '../../ui/dom.ts';
import { createFakeSizeObservers } from './host.fixture.ts';
import type { FakeSizeObserver } from './host.fixture.ts';
import {
  createMasonry,
  DEFAULT_METRICS,
  gridMetrics,
  MASONRY_CLASS,
  masonrySpan,
  windowSizeObserver,
} from './masonry.ts';
import type { Masonry, SizeEntry } from './masonry.ts';

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

const span = (element: HTMLElement): string => element.style.getPropertyValue('grid-row-end');

describe('masonrySpan', () => {
  const metrics = { rowUnit: 4, gap: 16 };

  it('covers the height plus the gap in whole rows', () => {
    assert.equal(masonrySpan(84, metrics), 25);
    assert.equal(masonrySpan(85, metrics), 26);
    assert.equal(masonrySpan(100.5, metrics), 30);
    assert.equal(masonrySpan(100, { rowUnit: 2, gap: 10 }), 55);
  });

  it('keeps the gap for empty items and spans at least one row', () => {
    assert.equal(masonrySpan(0, metrics), 4);
    assert.equal(masonrySpan(-20, metrics), 4);
    assert.equal(masonrySpan(0, { rowUnit: 4, gap: 0 }), 1);
  });
});

describe('gridMetrics', () => {
  it('reads the row unit and the column gap', () => {
    assert.deepEqual(gridMetrics({ gridAutoRows: '2px', columnGap: '10px' }), {
      rowUnit: 2,
      gap: 10,
    });
    assert.deepEqual(gridMetrics({ gridAutoRows: '4px', columnGap: '0px' }), {
      rowUnit: 4,
      gap: 0,
    });
  });

  it('falls back to the defaults for unusable values', () => {
    assert.deepEqual(gridMetrics({ gridAutoRows: '', columnGap: '' }), DEFAULT_METRICS);
    assert.deepEqual(gridMetrics({ gridAutoRows: 'auto', columnGap: 'normal' }), DEFAULT_METRICS);
    assert.equal(gridMetrics({ gridAutoRows: '0px', columnGap: '8px' }).rowUnit, 4);
  });
});

describe('windowSizeObserver', () => {
  it('returns null without ResizeObserver', () => {
    assert.equal(windowSizeObserver({}), null);
    assert.equal(windowSizeObserver({ ResizeObserver: undefined }), null);
  });

  it('wraps the ResizeObserver of the window', () => {
    const created: FakeResizeObserver[] = [];
    class FakeResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        created.push(this);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const factory = windowSizeObserver({ ResizeObserver: FakeResizeObserver });
    assert.ok(factory);
    const received: (readonly SizeEntry[])[] = [];
    const observer = factory((entries) => received.push(entries));
    assert.equal(observer, created[0]);
    const entries: ResizeObserverEntry[] = [];
    created[0]?.callback(entries, created[0]);
    assert.equal(received[0], entries);
  });
});

interface Setup {
  readonly grid: HTMLElement;
  readonly items: HTMLElement[];
  readonly masonry: Masonry;
  readonly observer: FakeSizeObserver;
}

function setup(grid = h('div', null, h('section'), h('section'), h('section'))): Setup {
  if (grid.ownerDocument === document) {
    document.body.append(grid);
  }
  const observers = createFakeSizeObservers();
  const masonry = createMasonry({ grid, createObserver: observers.factory });
  const observer = observers.instances[0];
  assert.ok(observer);
  const items = [...grid.children].filter((child) => child instanceof HTMLElement);
  return { grid, items, masonry, observer };
}

describe('createMasonry', () => {
  it('does nothing without an observer', () => {
    const grid = h('div', null, h('section'));
    const masonry = createMasonry({ grid, createObserver: null });
    masonry.sync();
    masonry.dispose();
    assert.equal(grid.classList.contains(MASONRY_CLASS), false);
    assert.equal(grid.firstElementChild?.getAttribute('style'), null);
  });

  it('switches the grid to masonry and observes its children on sync', () => {
    const { grid, items, masonry, observer } = setup();
    assert.ok(grid.classList.contains(MASONRY_CLASS));
    assert.equal(observer.observed.size, 0);
    masonry.sync();
    assert.deepEqual([...observer.observed], items);
  });

  it('sets the span of resized children in one pass', () => {
    const { items, masonry, observer } = setup();
    masonry.sync();
    const [a, b, c] = items;
    assert.ok(a && b && c);
    observer.resize([a, 284], [b, 84], [c, 100.5]);
    assert.deepEqual(items.map(span), ['span 75', 'span 25', 'span 30']);
  });

  it('recomputes when content, forms or the column width change a height', () => {
    const { items, masonry, observer } = setup();
    masonry.sync();
    const [a, b] = items;
    assert.ok(a && b);
    observer.resize([a, 84], [b, 84]);
    observer.resize([a, 184]);
    assert.deepEqual(items.slice(0, 2).map(span), ['span 50', 'span 25']);
  });

  it('follows added and removed children', () => {
    const { grid, items, masonry, observer } = setup();
    masonry.sync();
    const [a] = items;
    assert.ok(a);
    a.remove();
    const added = h('section');
    grid.append(added);
    masonry.sync();
    assert.equal(observer.observed.has(a), false);
    assert.ok(observer.observed.has(added));
    assert.equal(observer.observed.size, 3);
    observer.resize([a, 84], [added, 84]);
    assert.equal(span(a), '', 'removed children are left alone');
    assert.equal(span(added), 'span 25');
    masonry.sync();
    assert.equal(observer.observed.size, 3);
  });

  it('measures the element when the entry has no border box size', () => {
    const { items, masonry, observer } = setup();
    masonry.sync();
    const [a, b] = items;
    assert.ok(a && b);
    for (const element of [a, b]) {
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 44 }),
      });
    }
    observer.report([{ target: a }, { target: b, borderBoxSize: [] }]);
    assert.deepEqual([span(a), span(b)], ['span 15', 'span 15']);
  });

  it('reads the metrics from the computed style of the grid', () => {
    const grid = h('div', null, h('section'));
    grid.style.setProperty('grid-auto-rows', '2px');
    grid.style.setProperty('column-gap', '10px');
    const { items, masonry, observer } = setup(grid);
    masonry.sync();
    const [a] = items;
    assert.ok(a);
    observer.resize([a, 100]);
    assert.equal(span(a), 'span 55');
  });

  it('uses the default metrics in documents without a window', () => {
    const detached = document.implementation.createHTMLDocument('detached');
    const grid = detached.createElement('div');
    const item = detached.createElement('section');
    grid.append(item);
    detached.body.append(grid);
    const { masonry, observer } = setup(grid);
    masonry.sync();
    observer.resize([item, 84]);
    assert.equal(item.style.getPropertyValue('grid-row-end'), 'span 25');
  });

  it('ignores children that cannot be styled', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const grid = h('div', null, h('section'));
    grid.append(svg);
    const { items, masonry, observer } = setup(grid);
    masonry.sync();
    assert.ok(observer.observed.has(svg));
    const [a] = items;
    assert.ok(a);
    observer.resize([svg, 84], [a, 84]);
    assert.equal(svg.getAttribute('style'), null);
    assert.equal(span(a), 'span 25');
  });

  it('disconnects and leaves masonry mode on dispose', () => {
    const { grid, items, masonry, observer } = setup();
    masonry.sync();
    masonry.dispose();
    assert.equal(observer.disconnected, true);
    assert.equal(grid.classList.contains(MASONRY_CLASS), false);
    const [a] = items;
    assert.ok(a);
    observer.resize([a, 84]);
    assert.equal(span(a), '');
  });
});
