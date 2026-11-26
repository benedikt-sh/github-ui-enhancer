export const NOT_A_SUBSEQUENCE = -1;

const CHAR_SCORE = 1;
const BONUS = 2;
const GAP_PENALTY = 0.25;
const PERFECT_CHAR_SCORE = CHAR_SCORE + BONUS;

// Reused across calls because this runs for thousands of repos on every keystroke.
let previousRow = new Float64Array(64);
let currentRow = new Float64Array(64);
let backPointers = new Int32Array(256);

function isSubsequence(text: string, pattern: string, from: number, to: number): boolean {
  let position = from;
  for (let i = 0; i < pattern.length; i++) {
    const found = text.indexOf(pattern.charAt(i), position);
    if (found === -1 || found >= to) {
      return false;
    }
    position = found + 1;
  }
  return true;
}

function ensureCapacity(width: number, cells: number): void {
  if (previousRow.length < width) {
    previousRow = new Float64Array(width * 2);
    currentRow = new Float64Array(width * 2);
  }
  if (backPointers.length < cells) {
    backPointers = new Int32Array(cells * 2);
  }
}

/**
 * Finds the best placement of `pattern` as a subsequence of `text[from, to)` and returns its
 * quality: 1 for a fully consecutive match starting at a word start, falling towards 0.
 * Every matched char scores 1, plus 2 if it follows the previous match directly or starts
 * a word; every skipped char between two matches costs 0.25. Runs in O(pattern x window).
 * When `positions` is given, it receives the matched indices into `text`, ascending.
 */
export function matchSubsequence(
  text: string,
  wordStart: Uint8Array,
  pattern: string,
  from: number,
  to: number,
  positions: number[] | null,
): number {
  const patternLength = pattern.length;
  if (patternLength === 0 || !isSubsequence(text, pattern, from, to)) {
    return NOT_A_SUBSEQUENCE;
  }
  const width = to - from;
  ensureCapacity(width, positions === null ? 0 : patternLength * width);
  let previous = previousRow;
  let current = currentRow;
  const back = backPointers;

  const first = pattern.charCodeAt(0);
  for (let j = 0; j < width; j++) {
    previous[j] =
      text.charCodeAt(from + j) === first
        ? CHAR_SCORE + (wordStart[from + j] === 1 ? BONUS : 0)
        : -Infinity;
  }

  for (let i = 1; i < patternLength; i++) {
    const code = pattern.charCodeAt(i);
    current[0] = -Infinity;
    // Best `previous[k] + GAP_PENALTY * k` over k <= j - 2, so a gap costs O(1) per cell.
    let bestGapped = -Infinity;
    let bestGappedAt = -1;
    for (let j = 1; j < width; j++) {
      if (j >= 2) {
        const candidate = (previous[j - 2] ?? -Infinity) + GAP_PENALTY * (j - 2);
        if (candidate > bestGapped) {
          bestGapped = candidate;
          bestGappedAt = j - 2;
        }
      }
      if (text.charCodeAt(from + j) !== code) {
        current[j] = -Infinity;
        continue;
      }
      let value = (previous[j - 1] ?? -Infinity) + PERFECT_CHAR_SCORE;
      let cameFrom = j - 1;
      const gapped =
        bestGapped -
        GAP_PENALTY * (j - 1) +
        CHAR_SCORE +
        (wordStart[from + j] === 1 ? BONUS : 0);
      if (gapped > value) {
        value = gapped;
        cameFrom = bestGappedAt;
      }
      current[j] = value;
      if (positions !== null) {
        back[i * width + j] = cameFrom;
      }
    }
    [previous, current] = [current, previous];
  }

  let bestScore = -Infinity;
  let end = 0;
  for (let j = 0; j < width; j++) {
    const score = previous[j] ?? -Infinity;
    if (score > bestScore) {
      bestScore = score;
      end = j;
    }
  }

  if (positions !== null) {
    positions.length = patternLength;
    let j = end;
    for (let i = patternLength - 1; i >= 0; i--) {
      positions[i] = from + j;
      j = back[i * width + j] ?? 0;
    }
  }
  return Math.max(0, bestScore) / (PERFECT_CHAR_SCORE * patternLength);
}
