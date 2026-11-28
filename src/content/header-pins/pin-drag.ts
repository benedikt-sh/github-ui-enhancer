/** Pixels the pointer has to travel before a press on a pin becomes a drag. */
export const DRAG_THRESHOLD = 4;

export const ITEM_SELECTOR = '[data-pin-index]';
export const DRAGGING_CLASS = 'ghx-header-pins__list--dragging';
export const ITEM_DRAGGING_CLASS = 'ghx-header-pins__item--dragging';
export const DROP_BEFORE_CLASS = 'ghx-header-pins__item--drop-before';
export const DROP_AFTER_CLASS = 'ghx-header-pins__item--drop-after';

/**
 * How long after a drag the following click is swallowed. Browsers send it right after the
 * release, the window only guards against clicks that never come.
 */
export const SWALLOW_CLICK_MS = 400;

/** Controls inside an item keep their own behavior and never start a drag. */
const INTERACTIVE = 'button, input, select, textarea';

/** Position among the other pins, given their centers along the drag axis in order. */
export function dropIndex(centers: readonly number[], position: number): number {
  return centers.filter((center) => center < position).length;
}

export interface PinDragClasses {
  readonly list: string;
  readonly item: string;
  readonly dropBefore: string;
  readonly dropAfter: string;
}

const BAR_CLASSES: PinDragClasses = {
  list: DRAGGING_CLASS,
  item: ITEM_DRAGGING_CLASS,
  dropBefore: DROP_BEFORE_CLASS,
  dropAfter: DROP_AFTER_CLASS,
};

export interface PinDragOptions {
  readonly document: Document;
  /** The list holding the pins; pinned items carry `data-pin-index`. */
  readonly list: HTMLElement;
  readonly onMove: (from: number, to: number) => void;
  /** `x` for the header bar (default), `y` for the vertical list in the panel. */
  readonly axis?: 'x' | 'y';
  readonly classes?: PinDragClasses;
  /**
   * Runs the move after the click that follows the release, defaults to the next task. Moving
   * right away re-renders the pins, and a link removed that way still navigates when clicked.
   */
  readonly defer?: (run: () => void) => void;
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
  const axis = options.axis ?? 'x';
  const classes = options.classes ?? BAR_CLASSES;
  const defer = options.defer ?? ((run: () => void) => void setTimeout(run, 0));
  let gesture: Gesture | null = null;
  let swallowTimer: ReturnType<typeof setTimeout> | null = null;

  function pinnedItems(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  }

  function clearIndicators(): void {
    for (const item of pinnedItems()) {
      item.classList.remove(classes.dropBefore, classes.dropAfter);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest(ITEM_SELECTOR) ?? null;
    stopSwallowing();
    if (
      event.button !== 0 ||
      !(item instanceof HTMLElement) ||
      !list.contains(item) ||
      target?.closest(INTERACTIVE) != null ||
      gesture !== null
    ) {
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
      list.classList.add(classes.list);
      gesture.item.classList.add(classes.item);
    }
    const others = pinnedItems().filter((item) => item !== gesture?.item);
    const centers = others.map((item) => {
      const rect = item.getBoundingClientRect();
      return axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    });
    gesture.to = dropIndex(centers, axis === 'x' ? event.clientX : event.clientY);
    clearIndicators();
    const before = others[gesture.to];
    if (before !== undefined) {
      before.classList.add(classes.dropBefore);
    } else {
      others.at(-1)?.classList.add(classes.dropAfter);
    }
  }

  function onPointerUp(): void {
    const finished = gesture;
    end();
    if (finished?.dragging === true && finished.to !== finished.from) {
      const { from, to } = finished;
      defer(() => options.onMove(from, to));
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
    list.classList.remove(classes.list);
    finished?.item.classList.remove(classes.item);
    clearIndicators();
    if (finished?.dragging === true) {
      startSwallowing();
    }
  }

  /** The release after a drag would otherwise open the repository below the pointer. */
  function startSwallowing(): void {
    stopSwallowing();
    document.addEventListener('click', onClick, true);
    swallowTimer = setTimeout(stopSwallowing, SWALLOW_CLICK_MS);
  }

  function stopSwallowing(): void {
    document.removeEventListener('click', onClick, true);
    if (swallowTimer !== null) {
      clearTimeout(swallowTimer);
      swallowTimer = null;
    }
  }

  function onClick(event: Event): void {
    stopSwallowing();
    event.preventDefault();
    event.stopPropagation();
  }

  list.addEventListener('pointerdown', onPointerDown);
  return () => {
    list.removeEventListener('pointerdown', onPointerDown);
    end();
    stopSwallowing();
  };
}
