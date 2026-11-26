import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeRanges, splitHighlights } from './highlight.ts';

describe('mergeRanges', () => {
  it('sorts and merges overlapping and touching ranges', () => {
    assert.deepEqual(
      mergeRanges([
        [8, 10],
        [0, 2],
        [2, 4],
        [3, 5],
      ]),
      [
        [0, 5],
        [8, 10],
      ],
    );
  });

  it('keeps an enclosing range when a nested one follows', () => {
    assert.deepEqual(
      mergeRanges([
        [0, 10],
        [2, 4],
      ]),
      [[0, 10]],
    );
  });

  it('drops empty ranges and accepts an empty list', () => {
    assert.deepEqual(
      mergeRanges([
        [3, 3],
        [5, 4],
      ]),
      [],
    );
    assert.deepEqual(mergeRanges([]), []);
  });
});

describe('splitHighlights', () => {
  it('alternates plain and highlighted pieces', () => {
    assert.deepEqual(
      splitHighlights('acme/api-gateway', [
        [5, 8],
        [0, 4],
      ]),
      [
        { text: 'acme', highlighted: true },
        { text: '/', highlighted: false },
        { text: 'api', highlighted: true },
        { text: '-gateway', highlighted: false },
      ],
    );
  });

  it('returns the whole text as one plain piece without ranges', () => {
    assert.deepEqual(splitHighlights('hello', []), [{ text: 'hello', highlighted: false }]);
    assert.deepEqual(splitHighlights('', []), []);
  });

  it('clamps ranges that reach past the end of the text', () => {
    assert.deepEqual(
      splitHighlights('abc', [
        [1, 2],
        [5, 7],
      ]),
      [
        { text: 'a', highlighted: false },
        { text: 'b', highlighted: true },
        { text: 'c', highlighted: false },
      ],
    );
    assert.deepEqual(
      splitHighlights('abc', [[2, 9]]),
      [
        { text: 'ab', highlighted: false },
        { text: 'c', highlighted: true },
      ],
    );
  });
});
