import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchSubsequence } from './subsequence.ts';
import { foldText, wordStarts } from './text-fold.ts';

function match(original: string, pattern: string, from?: number, to?: number) {
  const folded = foldText(original);
  return matchSubsequence(folded.text, wordStarts(original, folded), pattern, from, to);
}

describe('matchSubsequence', () => {
  it('rejects patterns that are not a subsequence', () => {
    assert.equal(match('acme/api-gateway', 'wg'), null);
    assert.equal(match('acme/api-gateway', 'xyz'), null);
  });

  it('rejects an empty pattern', () => {
    assert.equal(match('acme/api-gateway', ''), null);
  });

  it('rates a consecutive match at a word start as perfect', () => {
    assert.deepEqual(match('acme/api-gateway', 'api'), { quality: 1, positions: [5, 6, 7] });
  });

  it('prefers word starts over the first occurrence', () => {
    assert.deepEqual(match('acme/api-gateway', 'ag')?.positions, [5, 9]);
    assert.deepEqual(match('billing-service', 'bs')?.positions, [0, 8]);
    assert.deepEqual(match('myHttpServer', 'hs')?.positions, [2, 6]);
  });

  it('prefers consecutive characters over scattered ones', () => {
    assert.deepEqual(match('team-ab-auth-bridge', 'aut')?.positions, [8, 9, 10]);
  });

  it('rates large gaps lower than small ones', () => {
    const close = match('payment-service', 'pas');
    const far = match('platform-tools-and-scripts-and-services', 'pas');
    assert.ok(close !== null && far !== null);
    assert.ok(close.quality > far.quality, `${close.quality} > ${far.quality}`);
    assert.ok(far.quality >= 0);
  });

  it('clamps the quality at zero for very spread out matches', () => {
    const spread = match(`x${'y'.repeat(80)}z`, 'xz');
    assert.deepEqual(spread, { quality: 0, positions: [0, 81] });
  });

  it('stays inside the given window', () => {
    assert.deepEqual(match('api/api-gateway', 'api', 4)?.positions, [4, 5, 6]);
    assert.equal(match('acme/api', 'ap', 0, 4), null);
  });

  it('handles a single character pattern', () => {
    assert.deepEqual(match('octo/hello-world', 'w'), { quality: 1, positions: [11] });
    assert.deepEqual(match('octo/hello', 'l'), { quality: 1 / 3, positions: [7] });
  });
});
