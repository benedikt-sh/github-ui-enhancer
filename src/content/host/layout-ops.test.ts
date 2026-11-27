import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DashboardLayout, WidgetInstance } from '../../shared/layout.ts';
import {
  addInstance,
  moveInstance,
  placeBeside,
  placeInstance,
  removeInstance,
  setInstanceConfig,
  toggleWidth,
} from './layout-ops.ts';

function instance(id: string, overrides: Partial<WidgetInstance> = {}): WidgetInstance {
  return { id, type: 'list', width: 'half', config: null, ...overrides };
}

const layout: DashboardLayout = {
  version: 1,
  instances: [instance('a'), instance('b'), instance('c')],
};

const ids = (value: DashboardLayout): string[] => value.instances.map((entry) => entry.id);

describe('layout operations', () => {
  it('adds an instance at the end', () => {
    assert.deepEqual(ids(addInstance(layout, instance('d'))), ['a', 'b', 'c', 'd']);
  });

  it('removes an instance', () => {
    assert.deepEqual(ids(removeInstance(layout, 'b')), ['a', 'c']);
  });

  it('moves instances up and down', () => {
    assert.deepEqual(ids(moveInstance(layout, 'b', -1)), ['b', 'a', 'c']);
    assert.deepEqual(ids(moveInstance(layout, 'b', 1)), ['a', 'c', 'b']);
    assert.deepEqual(ids(moveInstance(layout, 'a', 5)), ['b', 'c', 'a']);
  });

  it('returns the same layout when nothing moves', () => {
    assert.equal(moveInstance(layout, 'a', -1), layout);
    assert.equal(moveInstance(layout, 'c', 1), layout);
    assert.equal(moveInstance(layout, 'missing', 1), layout);
  });

  it('places an instance before or after another one', () => {
    assert.deepEqual(ids(placeInstance(layout, 'c', 'a', 'before')), ['c', 'a', 'b']);
    assert.deepEqual(ids(placeInstance(layout, 'c', 'a', 'after')), ['a', 'c', 'b']);
    assert.deepEqual(ids(placeInstance(layout, 'a', 'c', 'after')), ['b', 'c', 'a']);
    assert.deepEqual(ids(placeInstance(layout, 'a', 'c', 'before')), ['b', 'a', 'c']);
    assert.deepEqual(ids(placeInstance(layout, 'a', 'b', 'after')), ['b', 'a', 'c']);
  });

  it('returns the same layout when placing changes nothing', () => {
    assert.equal(placeInstance(layout, 'a', 'b', 'before'), layout);
    assert.equal(placeInstance(layout, 'b', 'a', 'after'), layout);
    assert.equal(placeInstance(layout, 'b', 'b', 'before'), layout);
    assert.equal(placeInstance(layout, 'missing', 'a', 'before'), layout);
    assert.equal(placeInstance(layout, 'a', 'missing', 'after'), layout);
  });

  it('places plain entries with a custom id accessor', () => {
    const list = ['x', 'y', 'z'];
    assert.deepEqual(placeBeside(list, (entry) => entry, 'z', 'y', 'before'), ['x', 'z', 'y']);
    assert.equal(placeBeside(list, (entry) => entry, 'y', 'z', 'before'), null);
    assert.deepEqual(list, ['x', 'y', 'z']);
  });

  it('toggles the width', () => {
    const full = toggleWidth(layout, 'a');
    assert.equal(full.instances[0]?.width, 'full');
    assert.equal(full.instances[1]?.width, 'half');
    assert.equal(toggleWidth(full, 'a').instances[0]?.width, 'half');
  });

  it('replaces the config of one instance', () => {
    const next = setInstanceConfig(layout, 'c', { query: 'is:open' });
    assert.deepEqual(next.instances[2]?.config, { query: 'is:open' });
    assert.equal(next.instances[0], layout.instances[0]);
  });
});
