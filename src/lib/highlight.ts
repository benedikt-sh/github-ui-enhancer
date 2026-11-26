/** Half-open `[start, end)` range of UTF-16 indices into the original string. */
export type HighlightRange = readonly [start: number, end: number];

export interface HighlightSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

/** Sorts ranges and merges overlapping or touching ones. Empty ranges are dropped. */
export function mergeRanges(ranges: readonly HighlightRange[]): HighlightRange[] {
  const sorted = ranges.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Cuts `text` into alternating plain and highlighted pieces, ready for rendering. */
export function splitHighlights(
  text: string,
  ranges: readonly HighlightRange[],
): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let position = 0;
  for (const [start, rawEnd] of mergeRanges(ranges)) {
    const end = Math.min(rawEnd, text.length);
    if (end <= start) {
      continue;
    }
    if (start > position) {
      segments.push({ text: text.slice(position, start), highlighted: false });
    }
    segments.push({ text: text.slice(start, end), highlighted: true });
    position = end;
  }
  if (position < text.length) {
    segments.push({ text: text.slice(position), highlighted: false });
  }
  return segments;
}
