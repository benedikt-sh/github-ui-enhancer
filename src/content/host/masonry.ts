/** Switches the grid to small rows, see `host.css`. Only set while spans are maintained. */
export const MASONRY_CLASS = 'ghx-host-grid--masonry';

export interface GridMetrics {
  /** Height of one implicit grid row. */
  readonly rowUnit: number;
  /** Space kept below every item, the grid itself has no row gap in masonry mode. */
  readonly gap: number;
}

/** Matches `host.css`, used when the computed style cannot be read. */
export const DEFAULT_METRICS: GridMetrics = { rowUnit: 4, gap: 16 };

/** The part of `ResizeObserverEntry` the masonry needs. */
export interface SizeEntry {
  readonly target: Element;
  readonly borderBoxSize?: readonly { readonly blockSize: number }[];
}

export interface SizeObserver {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}

export type SizeObserverFactory = (
  onResize: (entries: readonly SizeEntry[]) => void,
) => SizeObserver;

/** Null when the browser has no `ResizeObserver`, the grid then keeps plain rows. */
export function windowSizeObserver(view: {
  readonly ResizeObserver?: typeof ResizeObserver | undefined;
}): SizeObserverFactory | null {
  const Observer = view.ResizeObserver;
  if (typeof Observer !== 'function') {
    return null;
  }
  return (onResize) => new Observer((entries) => onResize(entries));
}

export function gridMetrics(
  style: Pick<CSSStyleDeclaration, 'gridAutoRows' | 'columnGap'>,
): GridMetrics {
  const rowUnit = Number.parseFloat(style.gridAutoRows);
  const gap = Number.parseFloat(style.columnGap);
  return {
    rowUnit: rowUnit > 0 ? rowUnit : DEFAULT_METRICS.rowUnit,
    gap: gap >= 0 ? gap : DEFAULT_METRICS.gap,
  };
}

/** Number of grid rows an item of `height` pixels covers, including the gap below it. */
export function masonrySpan(height: number, metrics: GridMetrics): number {
  return Math.max(1, Math.ceil((Math.max(height, 0) + metrics.gap) / metrics.rowUnit));
}

export interface MasonryOptions {
  readonly grid: HTMLElement;
  readonly createObserver: SizeObserverFactory | null;
}

export interface Masonry {
  /** Starts measuring added grid children and stops for removed ones. */
  sync(): void;
  dispose(): void;
}

function heightOf(entry: SizeEntry): number {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
}

/**
 * Lets grid items move up into the space below shorter neighbors. Every child spans as many
 * small rows as its height needs, so auto placement puts the next item into the column that
 * ends first. Placement never goes back above an earlier item, which keeps the visual order
 * close to the DOM order.
 */
export function createMasonry(options: MasonryOptions): Masonry {
  const { grid, createObserver } = options;
  if (createObserver === null) {
    return { sync: () => undefined, dispose: () => undefined };
  }
  const view = grid.ownerDocument.defaultView;
  const observed = new Set<Element>();
  // A ResizeObserver delivers every resize of a frame in one call, after layout and before
  // paint. Reading the metrics once and then only writing spans keeps it to one extra layout
  // and avoids a frame with overlapping items, which deferring to the next frame would cause.
  const observer = createObserver((entries) => {
    const metrics = view === null ? DEFAULT_METRICS : gridMetrics(view.getComputedStyle(grid));
    const spans = entries
      .filter((entry) => observed.has(entry.target))
      .map((entry) => [entry.target, masonrySpan(heightOf(entry), metrics)] as const);
    for (const [target, span] of spans) {
      if (target instanceof HTMLElement) {
        target.style.setProperty('grid-row-end', `span ${span}`);
      }
    }
  });
  grid.classList.add(MASONRY_CLASS);

  return {
    sync() {
      const children = new Set(grid.children);
      for (const element of observed) {
        if (!children.has(element)) {
          observer.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of children) {
        if (!observed.has(element)) {
          observed.add(element);
          observer.observe(element);
        }
      }
    },
    dispose() {
      observer.disconnect();
      observed.clear();
      grid.classList.remove(MASONRY_CLASS);
    },
  };
}
