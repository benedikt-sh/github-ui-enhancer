import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { foldText, toOriginalRange, wordStarts } from './text-fold.ts';

function marked(original: string): string {
  const folded = foldText(original);
  const marks = wordStarts(original, folded);
  return [...folded.text].map((char, i) => (marks[i] === 1 ? char.toUpperCase() : char)).join('');
}

describe('foldText', () => {
  it('lower-cases ascii without an index mapping', () => {
    const folded = foldText('Acme/API-Gateway');
    assert.deepEqual(folded, { text: 'acme/api-gateway', mapping: null });
    assert.deepEqual(toOriginalRange(folded, 5, 8), [5, 8]);
  });

  it('strips diacritics and keeps the mapping to original indices', () => {
    const folded = foldText('Zürich-Café');
    assert.equal(folded.text, 'zurich-cafe');
    assert.deepEqual(toOriginalRange(folded, 1, 3), [1, 3]);
  });

  it('expands letters that have no combining mark', () => {
    const folded = foldText('Straße-Ørsted');
    assert.equal(folded.text, 'strasse-orsted');
    assert.deepEqual(toOriginalRange(folded, 4, 6), [4, 5]);
    assert.deepEqual(toOriginalRange(folded, 0, 6), [0, 5]);
    assert.deepEqual(toOriginalRange(folded, 8, 10), [7, 9]);
  });

  it('attaches decomposed combining marks to the preceding letter', () => {
    const original = 'café bar';
    const folded = foldText(original);
    assert.equal(folded.text, 'cafe bar');
    assert.deepEqual(toOriginalRange(folded, 0, 4), [0, 5]);
    assert.deepEqual(toOriginalRange(folded, 5, 8), [6, 9]);
  });

  it('ignores a combining mark at the very start', () => {
    const folded = foldText('́abc');
    assert.equal(folded.text, 'abc');
    assert.deepEqual(toOriginalRange(folded, 0, 1), [1, 2]);
  });

  it('keeps surrogate pairs addressable', () => {
    const folded = foldText('🚀Rocket');
    assert.equal(folded.text, '🚀rocket');
    assert.deepEqual(toOriginalRange(folded, 2, 8), [2, 8]);
  });

  it('maps a dotted capital I to a plain i', () => {
    assert.equal(foldText('İstanbul').text, 'istanbul');
  });
});

describe('wordStarts', () => {
  it('marks starts after separators', () => {
    assert.equal(marked('acme/api-gateway_v2.core'), 'Acme/Api-Gateway_V2.Core');
  });

  it('marks camelCase humps and the word after an acronym', () => {
    assert.equal(marked('myHTTPServer'), 'MyHttpServer');
    assert.equal(marked('parseJSON'), 'ParseJson');
  });

  it('marks starts after spaces and punctuation in descriptions', () => {
    assert.equal(marked('Fast (tiny) cache'), 'Fast (Tiny) Cache');
  });

  it('handles non-ascii letters and expanded letters', () => {
    assert.equal(marked('größeÄnderung über'), 'GrosseAnderung Uber');
  });

  it('does not split a letter at its combining mark', () => {
    assert.equal(marked('étude'), 'Etude');
  });

  it('treats non-ascii symbols as separators', () => {
    assert.equal(marked('a→b'), 'A→B');
  });
});
