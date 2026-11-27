import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  autoScrollStep,
  findDropTarget,
} from './drop-target.ts';
import type { Box, DropCandidate } from './drop-target.ts';

interface Item extends DropCandidate {
  readonly id: string;
}

interface Hit {
  readonly id: string;
  readonly side: string;
  readonly axis: string;
}

function hitAt(x: number, y: number, items: readonly Item[], width: number): Hit | null {
  const target = findDropTarget({ x, y }, items, width);
  return target && { id: target.candidate.id, side: target.side, axis: target.axis };
}

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/*
 * Two column grid, 1000px wide with a 20px gap:
 *   a (half) | b (half)      y 0-100
 *   c (full)                 y 120-220
 *   d (half)                 y 240-340
 */
const grid: Item[] = [
  { id: 'a', box: box(0, 0, 490, 100) },
  { id: 'b', box: box(510, 0, 490, 100) },
  { id: 'c', box: box(0, 120, 1000, 100) },
  { id: 'd', box: box(0, 240, 490, 100) },
];

const at = (x: number, y: number): Hit | null => hitAt(x, y, grid, 1000);

describe('findDropTarget', () => {
  it('returns null without candidates', () => {
    assert.equal(findDropTarget({ x: 0, y: 0 }, [], 1000), null);
  });

  it('uses left and right halves of items in a column', () => {
    assert.deepEqual(at(100, 50), { id: 'a', side: 'before', axis: 'x' });
    assert.deepEqual(at(400, 50), { id: 'a', side: 'after', axis: 'x' });
    assert.deepEqual(at(600, 50), { id: 'b', side: 'before', axis: 'x' });
    assert.deepEqual(at(900, 90), { id: 'b', side: 'after', axis: 'x' });
  });

  it('uses top and bottom halves of full width items', () => {
    assert.deepEqual(at(800, 130), { id: 'c', side: 'before', axis: 'y' });
    assert.deepEqual(at(100, 210), { id: 'c', side: 'after', axis: 'y' });
  });

  it('picks the nearest item for pointers in gaps and empty cells', () => {
    assert.deepEqual(at(500, 50), { id: 'a', side: 'after', axis: 'x' });
    assert.deepEqual(at(505, 50), { id: 'b', side: 'before', axis: 'x' });
    assert.deepEqual(at(800, 112), { id: 'c', side: 'before', axis: 'y' });
    assert.deepEqual(at(800, 300), { id: 'd', side: 'after', axis: 'x' });
  });

  it('drops at the start or the end beyond all items', () => {
    assert.deepEqual(at(900, -40), { id: 'a', side: 'before', axis: 'y' });
    assert.deepEqual(at(900, 400), { id: 'd', side: 'after', axis: 'y' });
  });

  it('stacks half width items vertically in a single column', () => {
    const column: Item[] = [
      { id: 'a', box: box(0, 0, 600, 100) },
      { id: 'b', box: box(0, 120, 600, 100) },
    ];
    assert.deepEqual(hitAt(10, 130, column, 600), {
      id: 'b',
      side: 'before',
      axis: 'y',
    });
    assert.deepEqual(hitAt(590, 90, column, 600), {
      id: 'a',
      side: 'after',
      axis: 'y',
    });
  });
});

describe('autoScrollStep', () => {
  it('does not scroll away from the edges', () => {
    assert.equal(autoScrollStep(AUTO_SCROLL_EDGE, 800), 0);
    assert.equal(autoScrollStep(400, 800), 0);
    assert.equal(autoScrollStep(800 - AUTO_SCROLL_EDGE, 800), 0);
  });

  it('scrolls up near the top and down near the bottom', () => {
    assert.equal(autoScrollStep(AUTO_SCROLL_EDGE - 1, 800), -1);
    assert.equal(autoScrollStep(0, 800), -AUTO_SCROLL_MAX_STEP);
    assert.equal(autoScrollStep(-50, 800), -AUTO_SCROLL_MAX_STEP);
    assert.equal(autoScrollStep(800 - AUTO_SCROLL_EDGE / 2, 800), AUTO_SCROLL_MAX_STEP / 2);
    assert.equal(autoScrollStep(900, 800), AUTO_SCROLL_MAX_STEP);
  });

  it('shrinks the edge in small viewports and ignores empty ones', () => {
    assert.equal(autoScrollStep(30, 100), 0);
    assert.equal(autoScrollStep(10, 100), -Math.ceil((AUTO_SCROLL_MAX_STEP * 15) / 25));
    assert.equal(autoScrollStep(0, 0), 0);
  });
});
