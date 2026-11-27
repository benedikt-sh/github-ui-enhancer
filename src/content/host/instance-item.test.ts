import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { WidgetInstance } from '../../shared/layout.ts';
import { createFakeWidget } from './host.fixture.ts';
import type { FakeWidget } from './host.fixture.ts';
import { createInstanceItem, FULL_WIDTH_CLASS, ITEM_CLASS } from './instance-item.ts';
import type { HostItem, InstanceItemOptions } from './instance-item.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

afterEach(() => {
  document.body.replaceChildren();
});

after(async () => {
  await dom.cleanup();
});

const instance: WidgetInstance = { id: 'i1', type: 'fake-list', width: 'half', config: null };

interface Setup {
  readonly item: HostItem;
  readonly calls: string[];
  readonly persisted: unknown[];
}

function setup(
  definition: FakeWidget | undefined,
  overrides: Partial<InstanceItemOptions> = {},
): Setup {
  const calls: string[] = [];
  const persisted: unknown[] = [];
  const item = createInstanceItem({
    instance,
    definition,
    data: createFakeWidgetData(),
    openOptions: () => calls.push('options'),
    reportError: () => calls.push('error'),
    persistConfig: async (id, config) => {
      persisted.push([id, config]);
    },
    onToggleWidth: (id) => calls.push(`width ${id}`),
    onMove: (id, offset) => calls.push(`move ${id} ${offset}`),
    onRemove: (id) => calls.push(`remove ${id}`),
    ...overrides,
  });
  document.body.append(item.root);
  return { item, calls, persisted };
}

const menuLabels = (item: HostItem): string[] =>
  [...item.root.querySelectorAll('[role="menuitem"]')].map((button) => button.textContent ?? '');

function menuButton(item: HostItem, label: string): HTMLButtonElement {
  const match = [...item.root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent === label,
  );
  assert.ok(match, `menu item "${label}" not found`);
  return match;
}

describe('createInstanceItem', () => {
  it('renders a known widget with the instance menu', () => {
    const widget = createFakeWidget();
    const { item } = setup(widget);
    item.update(instance, 0, 1);
    assert.ok(item.root.classList.contains(ITEM_CLASS));
    assert.equal(item.root.dataset['instanceId'], 'i1');
    assert.deepEqual(menuLabels(item), [
      'Refresh',
      'Use full width',
      'Move up',
      'Move down',
      'Remove',
    ]);
    assert.equal(menuButton(item, 'Move up').disabled, true);
    assert.equal(menuButton(item, 'Move down').disabled, true);
    assert.equal(widget.mounts.length, 1);
  });

  it('offers configure only for widgets with a config form', () => {
    const widget = createFakeWidget({ configurable: true });
    const { item } = setup(widget);
    assert.ok(menuLabels(item).includes('Configure'));
    menuButton(item, 'Configure').click();
    assert.equal(widget.forms.length, 1);
  });

  it('can start with the config form and persists through the host', () => {
    const widget = createFakeWidget({ configurable: true });
    const { persisted } = setup(widget, { startInConfig: true });
    assert.equal(widget.mounts.length, 0);
    widget.forms[0]?.context.submit({ name: 'x' });
    assert.deepEqual(persisted, [['i1', { name: 'x' }]]);
  });

  it('applies width and position updates', () => {
    const { item } = setup(createFakeWidget());
    item.update({ ...instance, width: 'full' }, 1, 3);
    assert.ok(item.root.classList.contains(FULL_WIDTH_CLASS));
    assert.equal(menuButton(item, 'Move up').disabled, false);
    assert.equal(menuButton(item, 'Move down').disabled, false);
    assert.ok(menuLabels(item).includes('Use half width'));
    item.update(instance, 2, 3);
    assert.ok(!item.root.classList.contains(FULL_WIDTH_CLASS));
    assert.equal(menuButton(item, 'Move down').disabled, true);
  });

  it('forwards menu actions', () => {
    const widget = createFakeWidget();
    const { item, calls } = setup(widget);
    item.update(instance, 1, 3);
    menuButton(item, 'Refresh').click();
    menuButton(item, 'Use full width').click();
    menuButton(item, 'Move up').click();
    menuButton(item, 'Move down').click();
    menuButton(item, 'Remove').click();
    assert.deepEqual(widget.active()?.refreshes, ['manual']);
    assert.deepEqual(calls, ['width i1', 'move i1 -1', 'move i1 1', 'remove i1']);
  });

  it('forwards refreshes and disposes the widget and its open menu', () => {
    const widget = createFakeWidget();
    const { item } = setup(widget);
    item.refresh('interval');
    const trigger = item.root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    trigger?.click();
    assert.equal(trigger?.getAttribute('aria-expanded'), 'true');
    item.dispose();
    assert.equal(trigger?.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(widget.mounts[0]?.refreshes, ['interval']);
    assert.equal(widget.mounts[0]?.disposed, true);
  });

  it('renders a placeholder for unknown widget types that can be removed', () => {
    const { item, calls } = setup(undefined, {
      instance: { ...instance, type: 'from-the-future', width: 'full' },
    });
    item.update({ ...instance, width: 'full' }, 0, 1);
    item.refresh('manual');
    assert.match(item.root.textContent ?? '', /Unknown widget/);
    assert.match(item.root.textContent ?? '', /"from-the-future"/);
    assert.ok(item.root.classList.contains(FULL_WIDTH_CLASS));
    item.root.querySelector<HTMLButtonElement>('button[aria-label="Remove widget"]')?.click();
    assert.deepEqual(calls, ['remove i1']);
    item.dispose();
  });
});
