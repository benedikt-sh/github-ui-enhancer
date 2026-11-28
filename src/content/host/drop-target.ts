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

export interface DropTarget<C extends DropCandidate> {
  readonly candidate: C;
  readonly side: DropSide;
}

/**
 * Horizontal distance counts this many times. Below the end of a short column the pointer
 * then still targets that column instead of a taller neighbor that happens to be closer.
 */
const HORIZONTAL_WEIGHT = 8;

function distance(point: Point, box: Box): number {
  return Math.hypot(
    HORIZONTAL_WEIGHT * Math.max(box.left - point.x, 0, point.x - box.right),
    Math.max(box.top - point.y, 0, point.y - box.bottom),
  );
}

/**
 * Finds where an item would land for a pointer position. Candidates are the grid items in
 * layout order, including the dragged one. Items flow like masonry, so there are no rows:
 * the item under the pointer wins, otherwise the nearest one, preferring the pointer's
 * column. The pointer's half of it picks before or after. Pointers above or below all items
 * drop at the start or the end.
 */
export function findDropTarget<C extends DropCandidate>(
  point: Point,
  candidates: readonly C[],
): DropTarget<C> | null {
  const first = candidates[0];
  const last = candidates.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  if (point.y < Math.min(...candidates.map((candidate) => candidate.box.top))) {
    return { candidate: first, side: 'before' };
  }
  if (point.y > Math.max(...candidates.map((candidate) => candidate.box.bottom))) {
    return { candidate: last, side: 'after' };
  }
  let nearest = first;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const value = distance(point, candidate.box);
    if (value < nearestDistance) {
      nearest = candidate;
      nearestDistance = value;
    }
  }
  const { top, bottom } = nearest.box;
  return { candidate: nearest, side: point.y < (top + bottom) / 2 ? 'before' : 'after' };
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
