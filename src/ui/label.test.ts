import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import {
  DARK_TEXT,
  labelList,
  labelPill,
  LIGHT_TEXT,
  normalizeHexColor,
  readableTextColor,
  relativeLuminance,
} from './label.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('normalizeHexColor', () => {
  it('accepts six and three digit colors with or without "#"', () => {
    assert.equal(normalizeHexColor('D73A4A'), 'd73a4a');
    assert.equal(normalizeHexColor(' #0e8a16 '), '0e8a16');
    assert.equal(normalizeHexColor('fc0'), 'ffcc00');
  });

  it('rejects anything else', () => {
    for (const value of ['', 'red', '12345', 'ggg000', 'fff;background:url(x)']) {
      assert.equal(normalizeHexColor(value), null, value);
    }
  });
});

describe('relativeLuminance', () => {
  it('spans from black to white', () => {
    assert.equal(relativeLuminance('000000'), 0);
    assert.equal(relativeLuminance('ffffff'), 1);
    assert.ok(relativeLuminance('808080') > 0.2 && relativeLuminance('808080') < 0.25);
  });
});

describe('readableTextColor', () => {
  it('uses dark text on light backgrounds', () => {
    for (const color of ['ffffff', 'fbca04', 'a2eeef', 'ededed', 'c5def5']) {
      assert.equal(readableTextColor(color), DARK_TEXT, color);
    }
  });

  it('uses light text on dark backgrounds', () => {
    for (const color of ['000000', 'd73a4a', '0e8a16', '5319e7', '0052cc']) {
      assert.equal(readableTextColor(color), LIGHT_TEXT, color);
    }
  });

  it('falls back to the default label color for invalid input', () => {
    assert.equal(readableTextColor('nope'), DARK_TEXT);
  });
});

describe('labelPill', () => {
  it('renders the name with background and text color', () => {
    const pill = labelPill({ name: 'bug', color: 'd73a4a' });

    assert.equal(pill.className, 'ghx-label');
    assert.equal(pill.textContent, 'bug');
    assert.equal(pill.title, 'bug');
    assert.equal(pill.style.getPropertyValue('background-color'), '#d73a4a');
    assert.equal(pill.style.getPropertyValue('color'), LIGHT_TEXT);
  });

  it('uses a neutral color for invalid colors and keeps names as text', () => {
    const pill = labelPill({ name: '<b>x</b>', color: 'red;position:fixed' });

    assert.equal(pill.style.getPropertyValue('background-color'), '#ededed');
    assert.equal(pill.style.getPropertyValue('position'), '');
    assert.equal(pill.children.length, 0);
    assert.equal(pill.textContent, '<b>x</b>');
  });
});

describe('labelList', () => {
  it('returns null without labels', () => {
    assert.equal(labelList([]), null);
  });

  it('wraps all pills', () => {
    const list = labelList([
      { name: 'a', color: '000000' },
      { name: 'b', color: 'ffffff' },
    ]);

    assert.equal(list?.className, 'ghx-labels');
    assert.equal(list?.querySelectorAll('.ghx-label').length, 2);
  });
});
