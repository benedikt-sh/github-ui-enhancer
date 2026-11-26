import type { HighlightRange } from './highlight.ts';

/**
 * Original range `[starts[i], ends[i])` that produced folded index `i`.
 * Null when the folded text has the same indices as the original.
 */
export interface FoldMapping {
  readonly starts: Int32Array;
  readonly ends: Int32Array;
}

/** Lower-cased text without diacritics plus the mapping back to the original string. */
export interface FoldedText {
  readonly text: string;
  readonly mapping: FoldMapping | null;
}

// Letters without a combining mark in NFD that would otherwise never match plain ASCII.
const LETTER_REPLACEMENTS = new Map([
  ['ß', 'ss'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ø', 'o'],
  ['ł', 'l'],
  ['đ', 'd'],
  ['ð', 'd'],
  ['þ', 'th'],
  ['ı', 'i'],
]);
const REPLACEABLE = /[ßæœøłđðþı]/gu;
const COMBINING_MARKS = /\p{M}/gu;
const ASCII_ONLY = /^[\u0000-\u007f]*$/;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

const foldedChars = new Map<string, string>();

function foldChar(char: string): string {
  let folded = foldedChars.get(char);
  if (folded === undefined) {
    folded = char
      .toLowerCase()
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(REPLACEABLE, (letter) => LETTER_REPLACEMENTS.get(letter) ?? letter);
    foldedChars.set(char, folded);
  }
  return folded;
}

export function foldText(original: string): FoldedText {
  if (ASCII_ONLY.test(original)) {
    return { text: original.toLowerCase(), mapping: null };
  }
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of original) {
    const folded = foldChar(char);
    const end = index + char.length;
    if (folded === '') {
      // A dropped combining mark belongs to the preceding letter for highlighting.
      if (ends.length > 0) {
        ends[ends.length - 1] = end;
      }
    } else {
      for (let k = 0; k < folded.length; k++) {
        starts.push(index);
        ends.push(end);
      }
      text += folded;
    }
    index = end;
  }
  return { text, mapping: { starts: Int32Array.from(starts), ends: Int32Array.from(ends) } };
}

/** Maps a non-empty folded range `[start, end)` back to original indices. */
export function toOriginalRange(folded: FoldedText, start: number, end: number): HighlightRange {
  const { mapping } = folded;
  if (mapping === null) {
    return [start, end];
  }
  return [mapping.starts[start] ?? 0, mapping.ends[end - 1] ?? 0];
}

function isWordChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code < 128) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  }
  return WORD_CHAR.test(char);
}

function isCamelHump(previous: string, current: string, next: string): boolean {
  if (!UPPER.test(current)) {
    return false;
  }
  return LOWER.test(previous) || (UPPER.test(previous) && LOWER.test(next));
}

/**
 * Marks folded indices that begin a word in the original: after a non-word character
 * such as `/ - _ .` or a space, or at a camelCase hump (`fooBar`, `HTTPServer`).
 */
export function wordStarts(original: string, folded: FoldedText): Uint8Array {
  const { text, mapping } = folded;
  const marks = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const at = mapping === null ? i : (mapping.starts[i] ?? 0);
    if (mapping !== null && i > 0 && mapping.starts[i - 1] === at) {
      continue;
    }
    const current = original.charAt(at);
    if (!isWordChar(current)) {
      continue;
    }
    const previous = at === 0 ? '' : original.charAt(at - 1);
    const next = original.charAt(at + current.length);
    if (previous === '' || !isWordChar(previous) || isCamelHump(previous, current, next)) {
      marks[i] = 1;
    }
  }
  return marks;
}
