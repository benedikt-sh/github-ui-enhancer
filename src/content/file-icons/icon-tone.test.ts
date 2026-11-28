import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FILE_ICONS } from './icon-data.ts';
import { contrastRatio, iconTone, parseHex } from './icon-tone.ts';

describe('parseHex', () => {
  it('reads six hex digits with or without hash', () => {
    assert.deepEqual(parseHex('ff0000'), [1, 0, 0]);
    assert.deepEqual(parseHex('#00FF00'), [0, 1, 0]);
    assert.deepEqual(parseHex('0000ff'), [0, 0, 1]);
  });

  it('rejects anything else', () => {
    assert.equal(parseHex('fff'), null);
    assert.equal(parseHex('ggggggg'), null);
    assert.equal(parseHex(''), null);
  });
});

describe('contrastRatio', () => {
  it('spans 1 to 21 and is symmetric', () => {
    assert.equal(contrastRatio([0, 0, 0], [1, 1, 1]), 21);
    assert.equal(contrastRatio([1, 1, 1], [0, 0, 0]), 21);
    assert.equal(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
  });

  it('linearizes dark channels', () => {
    assert.ok(contrastRatio([0.02, 0.02, 0.02], [0, 0, 0]) > 1);
  });
});

describe('iconTone', () => {
  it('keeps colors that work on both canvases', () => {
    assert.equal(iconTone('3178C6'), 'brand');
    assert.equal(iconTone('F03C2E'), 'brand');
  });

  it('uses the text color for gray logos and missing colors', () => {
    assert.equal(iconTone('000000'), 'mono');
    assert.equal(iconTone('FEFEFE'), 'mono');
    assert.equal(iconTone('263238'), 'mono');
    assert.equal(iconTone(null), 'mono');
    assert.equal(iconTone('nope'), 'mono');
  });

  it('darkens light colors and lightens dark ones', () => {
    assert.equal(iconTone('F7DF1E'), 'darken');
    assert.equal(iconTone('61DAFB'), 'darken');
    assert.equal(iconTone('0F1689'), 'lighten');
    assert.equal(iconTone('000080'), 'lighten');
  });

  it('knows a tone for every icon', () => {
    for (const icon of Object.values(FILE_ICONS)) {
      assert.ok(['brand', 'mono', 'darken', 'lighten'].includes(iconTone(icon.hex)), icon.title);
    }
  });
});
