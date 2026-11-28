import { autoScrollStep, findDropTarget } from './drop-target.ts';
import type { Box, DropTarget } from './drop-target.ts';
import { HANDLE_CLASS } from './instance-item.ts';
import { placeBeside } from './layout-ops.ts';
import type { DropSide } from './layout-ops.ts';
import type { Timers } from './refresh-scheduler.ts';

export const GRID_DRAGGING_CLASS = 'ghx-host-grid--dragging';
export const DRAGGING_CLASS = 'ghx-host-item--dragging';
export const DROP_BEFORE_CLASS = 'ghx-host-item--drop-before';
export const DROP_AFTER_CLASS = 'ghx-host-item--drop-after';

/** Pixels the pointer has to travel before a press on a handle becomes a drag. */
export const DRAG_THRESHOLD = 4;
export const AUTO_SCROLL_INTERVAL_MS = 16;

/** Controls inside a handle keep their own pointer behavior and never start a drag. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="menu"]';

export interface DragReorderOptions {
  /** Its direct children with a `data-instance-id` are the reorderable items. */
  readonly grid: HTMLElement;
  readonly canDrag: (id: string) => boolean;
  /** Only called for drops that change the order. */
  readonly onDrop: (id: string, targetId: string, side: DropSide) => void;
  readonly timers: Timers;
}

export interface DragReorder {
  readonly dragging: boolean;
  /** Ends a running drag without dropping. */
  cancel(): void;
  dispose(): void;
}

interface Entry {
  readonly id: string;
  readonly element: HTMLElement;
}

interface Placed extends Entry {
  readonly box: Box;
}

interface Gesture {
  readonly pointerId: number;
  readonly id: string;
  readonly item: HTMLElement;
  readonly handle: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  active: boolean;
  target: DropTarget<Placed> | null;
  stopScroll: (() => void) | null;
}

/** Reorders grid items by dragging their handle with pointer events (mouse, pen and touch). */
export function createDragReorder(options: DragReorderOptions): DragReorder {
  const { grid, canDrag, onDrop, timers } = options;
  const document = grid.ownerDocument;
  const view = document.defaultView;
  let gesture: Gesture | null = null;

  function entries(): Entry[] {
    const result: Entry[] = [];
    for (const element of grid.children) {
      if (element instanceof HTMLElement && element.dataset['instanceId'] !== undefined) {
        result.push({ id: element.dataset['instanceId'], element });
      }
    }
    return result;
  }

  function onPointerDown(event: PointerEvent): void {
    if (gesture !== null || event.button !== 0 || !event.isPrimary) {
      return;
    }
    const origin = event.target;
    if (!(origin instanceof Element)) {
      return;
    }
    const handle = origin.closest<HTMLElement>(`.${HANDLE_CLASS}`);
    const control = origin.closest(INTERACTIVE);
    const item = handle?.parentElement;
    const id = item?.dataset['instanceId'];
    if (
      handle === null ||
      (control !== null && handle.contains(control)) ||
      item?.parentElement !== grid ||
      id === undefined ||
      !canDrag(id)
    ) {
      return;
    }
    gesture = {
      pointerId: event.pointerId,
      id,
      item,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      target: null,
      stopScroll: null,
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function current(event: PointerEvent): Gesture | null {
    return gesture !== null && event.pointerId === gesture.pointerId ? gesture : null;
  }

  function onPointerMove(event: PointerEvent): void {
    const drag = current(event);
    if (drag === null) {
      return;
    }
    // A release outside the window may never arrive, the next move then has no button down.
    if ((event.buttons & 1) === 0) {
      end();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      start(drag);
    }
    event.preventDefault();
    updateTarget(drag);
    scheduleScroll(drag);
  }

  function onPointerUp(event: PointerEvent): void {
    const drag = current(event);
    if (drag === null) {
      return;
    }
    if (drag.active) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      updateTarget(drag);
    }
    const { id, target } = drag;
    end();
    if (target !== null) {
      onDrop(id, target.candidate.id, target.side);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (current(event) !== null) {
      end();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (gesture?.active && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end();
    }
  }

  function start(drag: Gesture): void {
    drag.active = true;
    grid.classList.add(GRID_DRAGGING_CLASS);
    drag.item.classList.add(DRAGGING_CLASS);
    try {
      drag.handle.setPointerCapture(drag.pointerId);
    } catch {
      // The pointer is already gone, the document listeners still see its events.
    }
  }

  function updateTarget(drag: Gesture): void {
    const placed = entries().map((entry) => ({
      ...entry,
      box: entry.element.getBoundingClientRect(),
    }));
    const target = findDropTarget({ x: drag.x, y: drag.y }, placed);
    const moves =
      target !== null &&
      placeBeside(placed, (entry) => entry.id, drag.id, target.candidate.id, target.side) !== null;
    showTarget(drag, moves ? target : null);
  }

  function showTarget(drag: Gesture, target: DropTarget<Placed> | null): void {
    drag.target?.candidate.element.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
    drag.target = target;
    if (target !== null) {
      target.candidate.element.classList.add(
        target.side === 'before' ? DROP_BEFORE_CLASS : DROP_AFTER_CLASS,
      );
    }
  }

  function scheduleScroll(drag: Gesture): void {
    if (view === null || drag.stopScroll !== null) {
      return;
    }
    if (autoScrollStep(drag.y, view.innerHeight) === 0) {
      return;
    }
    drag.stopScroll = timers.schedule(() => {
      drag.stopScroll = null;
      const step = autoScrollStep(drag.y, view.innerHeight);
      if (step !== 0) {
        view.scrollBy(0, step);
        updateTarget(drag);
        scheduleScroll(drag);
      }
    }, AUTO_SCROLL_INTERVAL_MS);
  }

  function end(): void {
    const drag = gesture;
    if (drag === null) {
      return;
    }
    gesture = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onKeyDown, true);
    drag.stopScroll?.();
    showTarget(drag, null);
    grid.classList.remove(GRID_DRAGGING_CLASS);
    drag.item.classList.remove(DRAGGING_CLASS);
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
  }

  grid.addEventListener('pointerdown', onPointerDown);

  return {
    get dragging() {
      return gesture?.active ?? false;
    },
    cancel: end,
    dispose() {
      end();
      grid.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
