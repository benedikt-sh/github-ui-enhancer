import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeStorageArea } from '../../test/fakes/storage.ts';
import { areaKey, createAreaStore } from './storage.ts';

describe('createAreaStore', () => {
  it('stores values under a prefixed key', async () => {
    const area = createFakeStorageArea();
    const store = createAreaStore(area);

    await store.set('layout', { version: 1 });

    assert.deepEqual(area.snapshot(), { 'ghx:layout': { version: 1 } });
    assert.deepEqual(await store.get('layout'), { version: 1 });
  });

  it('returns undefined for missing keys and after removal', async () => {
    const store = createAreaStore(createFakeStorageArea({ 'ghx:a': 1 }));

    assert.equal(await store.get('missing'), undefined);
    await store.remove('a');
    assert.equal(await store.get('a'), undefined);
  });

  it('ignores keys without the prefix', async () => {
    const store = createAreaStore(createFakeStorageArea({ layout: 'foreign' }));

    assert.equal(await store.get('layout'), undefined);
  });

  it('propagates storage failures', async () => {
    const area = createFakeStorageArea();
    area.failWith(new Error('QUOTA_BYTES quota exceeded'));

    await assert.rejects(createAreaStore(area).set('x', 1), /quota exceeded/);
  });
});

describe('areaKey', () => {
  it('prefixes keys like the store does', () => {
    assert.equal(areaKey('tweaks'), 'ghx:tweaks');
  });
});
