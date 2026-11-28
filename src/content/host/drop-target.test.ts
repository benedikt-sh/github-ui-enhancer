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
}

function hitAt(x: number, y: number, items: readonly Item[]): Hit | null {
  const target = findDropTarget({ x, y }, items);
  return target && { id: target.candidate.id, side: target.side };
}

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/*
 * Masonry in a 1000px grid with a 20px gap, c moved up below b:
 *   a (half, tall) | b (half)   a y 0-300, b y 0-100
 *                  | c (half)   c y 120-200
 *   d (full)                    y 320-420
 *   e (half)                    y 440-540
 */
const grid: Item[] = [
  { id: 'a', box: box(0, 0, 490, 300) },
  { id: 'b', box: box(510, 0, 490, 100) },
  { id: 'c', box: box(510, 120, 490, 80) },
  { id: 'd', box: box(0, 320, 1000, 100) },
  { id: 'e', box: box(0, 440, 490, 100) },
];

const at = (x: number, y: number): Hit | null => hitAt(x, y, grid);

describe('findDropTarget', () => {
  it('returns null without candidates', () => {
    assert.equal(findDropTarget({ x: 0, y: 0 }, []), null);
  });

  it('uses the top and bottom halves of the item under the pointer', () => {
    assert.deepEqual(at(100, 50), { id: 'a', side: 'before' });
    assert.deepEqual(at(400, 250), { id: 'a', side: 'after' });
    assert.deepEqual(at(600, 40), { id: 'b', side: 'before' });
    assert.deepEqual(at(900, 190), { id: 'c', side: 'after' });
    assert.deepEqual(at(800, 330), { id: 'd', side: 'before' });
    assert.deepEqual(at(100, 410), { id: 'd', side: 'after' });
  });

  it('prefers the pointer column below a short column', () => {
    assert.deepEqual(at(520, 220), { id: 'c', side: 'after' });
    assert.deepEqual(at(520, 290), { id: 'd', side: 'before' });
    assert.deepEqual(at(800, 500), { id: 'd', side: 'after' });
  });

  it('picks the nearest item in gaps', () => {
    assert.deepEqual(at(600, 105), { id: 'b', side: 'after' });
    assert.deepEqual(at(600, 115), { id: 'c', side: 'before' });
    assert.deepEqual(at(495, 50), { id: 'a', side: 'before' });
    assert.deepEqual(at(505, 60), { id: 'b', side: 'after' });
    assert.deepEqual(at(495, 430), { id: 'd', side: 'after' });
  });

  it('drops at the start or the end beyond all items', () => {
    assert.deepEqual(at(900, -40), { id: 'a', side: 'before' });
    assert.deepEqual(at(900, 600), { id: 'e', side: 'after' });
  });

  it('stacks items vertically in a single column', () => {
    const column: Item[] = [
      { id: 'a', box: box(0, 0, 600, 100) },
      { id: 'b', box: box(0, 120, 600, 100) },
    ];
    assert.deepEqual(hitAt(10, 130, column), { id: 'b', side: 'before' });
    assert.deepEqual(hitAt(590, 90, column), { id: 'a', side: 'after' });
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
