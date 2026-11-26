import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INDEX_STORAGE_KEY,
  entryStorageKey,
  parseIndex,
  parseStoredRecord,
  toStoredRecord,
} from './persisted-entry.ts';

describe('storage keys', () => {
  it('places entries and the index under the cache prefix without overlapping', () => {
    assert.equal(entryStorageKey('index'), 'cache:entry:index');
    assert.equal(INDEX_STORAGE_KEY, 'cache:index');
  });
});

describe('toStoredRecord and parseStoredRecord', () => {
  it('round-trip an entry', () => {
    const entry = { value: [1, 2], fetchedAt: 1000, meta: { etag: 'W/"abc"' } };

    assert.deepEqual(parseStoredRecord(structuredClone(toStoredRecord(entry))), entry);
  });

  it('rejects values that are not records of the current format', () => {
    assert.equal(parseStoredRecord(undefined), undefined);
    assert.equal(parseStoredRecord('text'), undefined);
    assert.equal(parseStoredRecord([1]), undefined);
    assert.equal(parseStoredRecord({ value: 1, fetchedAt: 1, meta: {} }), undefined);
    assert.equal(parseStoredRecord({ version: 2, value: 1, fetchedAt: 1, meta: {} }), undefined);
  });

  it('rejects missing or non-finite timestamps', () => {
    assert.equal(parseStoredRecord({ version: 1, value: 1 }), undefined);
    assert.equal(parseStoredRecord({ version: 1, value: 1, fetchedAt: '1' }), undefined);
    assert.equal(parseStoredRecord({ version: 1, value: 1, fetchedAt: Number.NaN }), undefined);
  });

  it('keeps the entry but drops broken metadata', () => {
    assert.deepEqual(parseStoredRecord({ version: 1, value: 1, fetchedAt: 5, meta: 'x' }), {
      value: 1,
      fetchedAt: 5,
      meta: {},
    });
    assert.deepEqual(
      parseStoredRecord({ version: 1, value: 1, fetchedAt: 5, meta: { etag: 'a', n: 3 } }),
      { value: 1, fetchedAt: 5, meta: { etag: 'a' } },
    );
  });
});

describe('parseIndex', () => {
  it('keeps string keys and ignores everything else', () => {
    assert.deepEqual(parseIndex(['a', 2, 'b', null]), ['a', 'b']);
    assert.deepEqual(parseIndex(undefined), []);
    assert.deepEqual(parseIndex({ keys: ['a'] }), []);
  });
});
