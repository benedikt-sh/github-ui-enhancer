import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchSubsequence, NOT_A_SUBSEQUENCE } from './subsequence.ts';
import { foldText, wordStarts } from './text-fold.ts';

function match(original: string, pattern: string, from = 0, to = original.length) {
  const folded = foldText(original);
  const marks = wordStarts(original, folded);
  const positions: number[] = [];
  const quality = matchSubsequence(folded.text, marks, pattern, from, to, positions);
  const scoreOnly = matchSubsequence(folded.text, marks, pattern, from, to, null);
  assert.equal(scoreOnly, quality);
  return quality === NOT_A_SUBSEQUENCE ? null : { quality, positions };
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

  it('grows its buffers for long texts', () => {
    const long = `${'ab-'.repeat(200)}target`;
    assert.deepEqual(match(long, 'target')?.positions, [600, 601, 602, 603, 604, 605]);
  });

  it('handles a single character pattern', () => {
    assert.deepEqual(match('octo/hello-world', 'w'), { quality: 1, positions: [11] });
    assert.deepEqual(match('octo/hello', 'l'), { quality: 1 / 3, positions: [7] });
  });
});
