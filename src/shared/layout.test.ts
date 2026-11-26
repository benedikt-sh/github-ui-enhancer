import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createId, parseLayout } from './layout.ts';

describe('parseLayout', () => {
  it('accepts a valid layout', () => {
    const raw = {
      version: 1,
      instances: [{ id: 'a', type: 'pr-list', width: 'full', config: { query: 'x' } }],
    };

    assert.deepEqual(parseLayout(raw), raw);
  });

  it('rejects values that are not a layout', () => {
    for (const raw of [undefined, null, [], { version: 2, instances: [] }, { version: 1 }]) {
      assert.equal(parseLayout(raw), null);
    }
  });

  it('drops broken and duplicate instances and defaults the width', () => {
    const layout = parseLayout({
      version: 1,
      instances: [
        { id: 'a', type: 'pr-list' },
        { id: '', type: 'pr-list' },
        { id: 'b' },
        'junk',
        { id: 'a', type: 'issue-list' },
        { id: 'c', type: 'issue-list', width: 'huge', config: 1 },
      ],
    });

    assert.deepEqual(layout, {
      version: 1,
      instances: [
        { id: 'a', type: 'pr-list', width: 'half', config: undefined },
        { id: 'c', type: 'issue-list', width: 'half', config: 1 },
      ],
    });
  });
});

describe('createId', () => {
  it('creates unique ids', () => {
    assert.notEqual(createId(), createId());
  });
});
