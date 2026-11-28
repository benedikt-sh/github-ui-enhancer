import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  byNewest,
  clampLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  mergeParts,
  type Part,
  uniqueErrors,
} from './merge.ts';

interface Item {
  readonly id: string;
  readonly at: string | null;
}

const NOW = '2026-11-27T12:00:00.000Z';

function part(items: Item[], overrides: Partial<Part<Item>> = {}): Part<Item> {
  return { items, errors: [], fetchedAt: '2026-11-27T11:00:00.000Z', stale: false, ...overrides };
}

const options = {
  identify: (item: Item) => item.id,
  compare: byNewest((item: Item) => item.at),
  now: NOW,
};

describe('clampLimit', () => {
  it('defaults and clamps', () => {
    assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
    assert.equal(clampLimit(Number.NaN), DEFAULT_LIMIT);
    assert.equal(clampLimit(Infinity), DEFAULT_LIMIT);
    assert.equal(clampLimit(0), 1);
    assert.equal(clampLimit(-5), 1);
    assert.equal(clampLimit(7.9), 7);
    assert.equal(clampLimit(500), MAX_LIMIT);
  });
});

describe('byNewest', () => {
  it('sorts newest first and missing timestamps last', () => {
    const items: Item[] = [
      { id: 'a', at: '2026-01-01' },
      { id: 'b', at: null },
      { id: 'c', at: '2026-03-01' },
      { id: 'd', at: null },
      { id: 'e', at: '2026-02-01' },
      { id: 'f', at: '2026-03-01' },
    ];

    assert.deepEqual(
      items.sort(options.compare).map((item) => item.id),
      ['c', 'f', 'e', 'a', 'b', 'd'],
    );
  });
});

describe('mergeParts', () => {
  it('dedupes, sorts, limits and keeps every error', () => {
    const result = mergeParts(
      [
        part([{ id: '1', at: '2026-01-01' }, { id: '2', at: '2026-01-03' }], {
          fetchedAt: '2026-11-27T11:30:00.000Z',
        }),
        part([{ id: '2', at: '2026-01-03' }, { id: '3', at: '2026-01-02' }], {
          errors: [{ kind: 'internal', message: 'cut' }],
          stale: true,
        }),
        part([], { errors: [{ kind: 'network', message: 'down' }], fetchedAt: null }),
      ],
      { ...options, limit: 2 },
    );

    assert.deepEqual(result, {
      data: [
        { id: '2', at: '2026-01-03' },
        { id: '3', at: '2026-01-02' },
      ],
      errors: [
        { kind: 'internal', message: 'cut' },
        { kind: 'network', message: 'down' },
      ],
      fetchedAt: '2026-11-27T11:00:00.000Z',
      stale: true,
    });
  });

  it('keeps everything without limit and uses now when nothing was fetched', () => {
    const result = mergeParts([part([], { fetchedAt: null })], options);

    assert.deepEqual(result, { data: [], errors: [], fetchedAt: NOW, stale: false });
    assert.equal(
      mergeParts([part(Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, at: null })))], options)
        .data.length,
      150,
    );
  });
});

describe('uniqueErrors', () => {
  it('keeps the first error of each kind and owner', () => {
    const down = { kind: 'network', message: 'GET /a failed', owner: 'acme' } as const;

    assert.deepEqual(
      uniqueErrors([
        down,
        { ...down, message: 'GET /b failed' },
        { ...down, owner: 'octo' },
        { kind: 'network', message: 'GET /c failed' },
        { kind: 'internal', message: 'GET /c failed', owner: 'acme' },
        { kind: 'network', message: 'GET /d failed' },
      ]),
      [
        down,
        { ...down, owner: 'octo' },
        { kind: 'network', message: 'GET /c failed' },
        { kind: 'internal', message: 'GET /c failed', owner: 'acme' },
      ],
    );
  });
});
