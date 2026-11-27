import type { DashboardLayout, WidgetInstance } from '../../shared/layout.ts';

export function addInstance(layout: DashboardLayout, instance: WidgetInstance): DashboardLayout {
  return { version: 1, instances: [...layout.instances, instance] };
}

export function removeInstance(layout: DashboardLayout, id: string): DashboardLayout {
  return { version: 1, instances: layout.instances.filter((instance) => instance.id !== id) };
}

/** Moves by `offset` positions, clamped to the ends of the list. */
export function moveInstance(layout: DashboardLayout, id: string, offset: number): DashboardLayout {
  const index = layout.instances.findIndex((instance) => instance.id === id);
  if (index < 0) {
    return layout;
  }
  const target = Math.min(Math.max(index + offset, 0), layout.instances.length - 1);
  if (target === index) {
    return layout;
  }
  const instances = [...layout.instances];
  instances.splice(target, 0, ...instances.splice(index, 1));
  return { version: 1, instances };
}

export type DropSide = 'before' | 'after';

/**
 * Moves the entry `id` directly before or after `targetId`. Returns null when either id is
 * missing or the order would not change, so callers can tell a no-op apart.
 */
export function placeBeside<T>(
  list: readonly T[],
  idOf: (entry: T) => string,
  id: string,
  targetId: string,
  side: DropSide,
): T[] | null {
  const index = list.findIndex((entry) => idOf(entry) === id);
  const entry = list[index];
  if (entry === undefined || id === targetId) {
    return null;
  }
  const rest = list.filter((_, position) => position !== index);
  const targetIndex = rest.findIndex((other) => idOf(other) === targetId);
  if (targetIndex < 0) {
    return null;
  }
  const insertAt = side === 'before' ? targetIndex : targetIndex + 1;
  if (insertAt === index) {
    return null;
  }
  rest.splice(insertAt, 0, entry);
  return rest;
}

/** Drag and drop counterpart of `moveInstance`, returns the same layout when nothing moves. */
export function placeInstance(
  layout: DashboardLayout,
  id: string,
  targetId: string,
  side: DropSide,
): DashboardLayout {
  const instances = placeBeside(layout.instances, (entry) => entry.id, id, targetId, side);
  return instances === null ? layout : { version: 1, instances };
}

function updateInstance(
  layout: DashboardLayout,
  id: string,
  update: (instance: WidgetInstance) => WidgetInstance,
): DashboardLayout {
  return {
    version: 1,
    instances: layout.instances.map((entry) => (entry.id === id ? update(entry) : entry)),
  };
}

export function toggleWidth(layout: DashboardLayout, id: string): DashboardLayout {
  return updateInstance(layout, id, (instance) => ({
    ...instance,
    width: instance.width === 'full' ? 'half' : 'full',
  }));
}

export function setInstanceConfig(
  layout: DashboardLayout,
  id: string,
  config: unknown,
): DashboardLayout {
  return updateInstance(layout, id, (instance) => ({ ...instance, config }));
}
