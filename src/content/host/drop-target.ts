import type { DropSide } from './layout-ops.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface DropCandidate {
  readonly box: Box;
}

/** `x` means the item shares its row with another column, so before/after is left/right. */
export type DropAxis = 'x' | 'y';

export interface DropTarget<C extends DropCandidate> {
  readonly candidate: C;
  readonly side: DropSide;
  readonly axis: DropAxis;
}

/** Items narrower than this share of the grid sit in one of its columns. */
const COLUMN_SHARE = 0.75;

function distance(point: Point, box: Box): number {
  return Math.hypot(
    Math.max(box.left - point.x, 0, point.x - box.right),
    Math.max(box.top - point.y, 0, point.y - box.bottom),
  );
}

function sideOn(axis: DropAxis, point: Point, box: Box): DropSide {
  const [position, start, end] =
    axis === 'x' ? [point.x, box.left, box.right] : [point.y, box.top, box.bottom];
  return position < (start + end) / 2 ? 'before' : 'after';
}

/**
 * Finds where an item would land for a pointer position. Candidates are the grid items in
 * layout order, including the dragged one. The item under the pointer wins, otherwise the
 * nearest one. Pointers above or below all items drop at the start or the end.
 */
export function findDropTarget<C extends DropCandidate>(
  point: Point,
  candidates: readonly C[],
  gridWidth: number,
): DropTarget<C> | null {
  const first = candidates[0];
  const last = candidates.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  if (point.y < Math.min(...candidates.map((candidate) => candidate.box.top))) {
    return { candidate: first, side: 'before', axis: 'y' };
  }
  if (point.y > Math.max(...candidates.map((candidate) => candidate.box.bottom))) {
    return { candidate: last, side: 'after', axis: 'y' };
  }
  // Items in the pointer's row win, so an empty cell next to an item still targets that item.
  const row = candidates.filter(({ box }) => box.top <= point.y && point.y <= box.bottom);
  let nearest = first;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of row.length > 0 ? row : candidates) {
    const value = distance(point, candidate.box);
    if (value < nearestDistance) {
      nearest = candidate;
      nearestDistance = value;
    }
  }
  const axis = nearest.box.right - nearest.box.left < gridWidth * COLUMN_SHARE ? 'x' : 'y';
  return { candidate: nearest, side: sideOn(axis, point, nearest.box), axis };
}

export const AUTO_SCROLL_EDGE = 48;
export const AUTO_SCROLL_MAX_STEP = 20;

/** Pixels to scroll per step, faster the closer the pointer is to the viewport edge. */
export function autoScrollStep(y: number, viewportHeight: number): number {
  const edge = Math.min(AUTO_SCROLL_EDGE, viewportHeight / 4);
  if (edge <= 0) {
    return 0;
  }
  const speed = (depth: number): number => Math.ceil((AUTO_SCROLL_MAX_STEP * depth) / edge);
  const above = edge - Math.max(y, 0);
  const below = Math.min(y, viewportHeight) - (viewportHeight - edge);
  if (above > 0) {
    return -speed(above);
  }
  return below > 0 ? speed(below) : 0;
}
