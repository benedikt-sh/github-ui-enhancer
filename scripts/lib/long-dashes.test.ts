import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findLongDashes, formatHit, isCheckedFile } from './long-dashes.ts';

describe('findLongDashes', () => {
  it('reports en and em dashes with line and column', () => {
    const hits = findLongDashes([
      { path: 'a.md', content: 'fine - line\nbad \u2013 here\nworse \u2014 and \u2014 again' },
    ]);

    assert.deepEqual(
      hits.map(({ line, column }) => [line, column]),
      [
        [2, 5],
        [3, 7],
        [3, 13],
      ],
    );
  });

  it('returns nothing for files with short hyphens only', () => {
    assert.deepEqual(findLongDashes([{ path: 'a.ts', content: 'const a = 1 - 2;' }]), []);
  });
});

describe('isCheckedFile', () => {
  it('checks source and documentation files', () => {
    assert.equal(isCheckedFile('src/a.ts'), true);
    assert.equal(isCheckedFile('docs/plan.md'), true);
    assert.equal(isCheckedFile('src/options/options.html'), true);
  });

  it('skips dependencies, the lockfile and binary files', () => {
    assert.equal(isCheckedFile('node_modules/x/index.js'), false);
    assert.equal(isCheckedFile('pnpm-lock.yaml'), false);
    assert.equal(isCheckedFile('pnpm-workspace.yaml'), true);
    assert.equal(isCheckedFile('icons/icon.png'), false);
  });
});

describe('formatHit', () => {
  it('formats a hit like a compiler diagnostic', () => {
    assert.equal(
      formatHit({ path: 'a.md', line: 2, column: 5, text: '  bad \u2013 here  ' }),
      'a.md:2:5: bad \u2013 here',
    );
  });
});
