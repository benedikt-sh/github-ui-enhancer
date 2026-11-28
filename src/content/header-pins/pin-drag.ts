/** Pixels the pointer has to travel before a press on a pin becomes a drag. */
export const DRAG_THRESHOLD = 4;

export const ITEM_SELECTOR = '[data-pin-index]';
export const DRAGGING_CLASS = 'ghx-header-pins__list--dragging';
export const ITEM_DRAGGING_CLASS = 'ghx-header-pins__item--dragging';
export const DROP_BEFORE_CLASS = 'ghx-header-pins__item--drop-before';
export const DROP_AFTER_CLASS = 'ghx-header-pins__item--drop-after';

/** Position among the other pins, given their horizontal centers in order. */
export function dropIndex(centers: readonly number[], x: number): number {
  return centers.filter((center) => center < x).length;
}

export interface PinDragOptions {
  readonly document: Document;
  /** The list holding the pins; pinned items carry `data-pin-index`. */
  readonly list: HTMLElement;
  readonly onMove: (from: number, to: number) => void;
}

interface Gesture {
  readonly item: HTMLElement;
  readonly from: number;
  readonly startX: number;
  readonly startY: number;
  dragging: boolean;
  to: number;
}

/** Lets the user reorder pins by dragging them along the header bar. Returns a dispose. */
export function attachPinDrag(options: PinDragOptions): () => void {
  const { document, list } = options;
  let gesture: Gesture | null = null;
  /** Set after a drag: the release over a pin link would otherwise open that repository. */
  let swallowClick = false;

  function pinnedItems(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  }

  function clearIndicators(): void {
    for (const item of pinnedItems()) {
      item.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    const item = event.target instanceof Element ? event.target.closest(ITEM_SELECTOR) : null;
    swallowClick = false;
    if (event.button !== 0 || !(item instanceof HTMLElement) || gesture !== null) {
      return;
    }
    gesture = {
      item,
      from: Number(item.dataset['pinIndex']),
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      to: Number(item.dataset['pinIndex']),
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (gesture === null) {
      return;
    }
    if (!gesture.item.isConnected) {
      cancel();
      return;
    }
    const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.dragging && moved < DRAG_THRESHOLD) {
      return;
    }
    if (!gesture.dragging) {
      gesture.dragging = true;
      list.classList.add(DRAGGING_CLASS);
      gesture.item.classList.add(ITEM_DRAGGING_CLASS);
    }
    const others = pinnedItems().filter((item) => item !== gesture?.item);
    const centers = others.map((item) => {
      const rect = item.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
    gesture.to = dropIndex(centers, event.clientX);
    clearIndicators();
    const before = others[gesture.to];
    if (before !== undefined) {
      before.classList.add(DROP_BEFORE_CLASS);
    } else {
      others.at(-1)?.classList.add(DROP_AFTER_CLASS);
    }
  }

  function onPointerUp(): void {
    const finished = gesture;
    end();
    if (finished?.dragging === true && finished.to !== finished.from) {
      options.onMove(finished.from, finished.to);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  function cancel(): void {
    end();
  }

  function end(): void {
    const finished = gesture;
    gesture = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', onKeyDown, true);
    list.classList.remove(DRAGGING_CLASS);
    finished?.item.classList.remove(ITEM_DRAGGING_CLASS);
    clearIndicators();
    swallowClick = finished?.dragging === true;
  }

  function onClick(event: Event): void {
    if (swallowClick) {
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  list.addEventListener('pointerdown', onPointerDown);
  list.addEventListener('click', onClick, true);
  return () => {
    list.removeEventListener('pointerdown', onPointerDown);
    list.removeEventListener('click', onClick, true);
    end();
  };
}
