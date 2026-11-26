export interface SubsequenceMatch {
  /** 1 for a fully consecutive match starting at a word start, falling towards 0. */
  readonly quality: number;
  /** Matched indices into the searched text, ascending. */
  readonly positions: readonly number[];
}

const CHAR_SCORE = 1;
const BONUS = 2;
const GAP_PENALTY = 0.25;
const PERFECT_CHAR_SCORE = CHAR_SCORE + BONUS;

function isSubsequence(text: string, pattern: string, from: number, to: number): boolean {
  let position = from;
  for (const char of pattern) {
    const found = text.indexOf(char, position);
    if (found === -1 || found >= to) {
      return false;
    }
    position = found + 1;
  }
  return true;
}

/**
 * Finds the best placement of `pattern` as a subsequence of `text[from, to)`.
 * Every matched char scores 1, plus 2 if it follows the previous match directly or starts
 * a word; every skipped char between two matches costs 0.25. Runs in O(pattern x window).
 */
export function matchSubsequence(
  text: string,
  wordStart: Uint8Array,
  pattern: string,
  from = 0,
  to = text.length,
): SubsequenceMatch | null {
  const patternLength = pattern.length;
  if (patternLength === 0 || !isSubsequence(text, pattern, from, to)) {
    return null;
  }
  const width = to - from;
  let previous = new Float64Array(width).fill(-Infinity);
  let current = new Float64Array(width);
  const back = new Int32Array(patternLength * width);

  const first = pattern.charCodeAt(0);
  for (let j = 0; j < width; j++) {
    if (text.charCodeAt(from + j) === first) {
      previous[j] = CHAR_SCORE + (wordStart[from + j] === 1 ? BONUS : 0);
    }
  }

  for (let i = 1; i < patternLength; i++) {
    const code = pattern.charCodeAt(i);
    current.fill(-Infinity);
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
      back[i * width + j] = cameFrom;
    }
    [previous, current] = [current, previous];
  }

  let bestScore = -Infinity;
  let end = -1;
  for (let j = 0; j < width; j++) {
    const score = previous[j] ?? -Infinity;
    if (score > bestScore) {
      bestScore = score;
      end = j;
    }
  }

  const positions = new Array<number>(patternLength);
  let j = end;
  for (let i = patternLength - 1; i >= 0; i--) {
    positions[i] = from + j;
    j = back[i * width + j] ?? 0;
  }
  const quality = Math.max(0, bestScore) / (PERFECT_CHAR_SCORE * patternLength);
  return { quality, positions };
}
