import type { WidgetData } from '../../shared/data.ts';
import type { WidgetInstance } from '../../shared/layout.ts';
import type { ErasedWidgetDefinition, RefreshReason } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { iconButton } from '../../ui/forms.ts';
import { dropdownMenu } from '../../ui/menu.ts';
import type { MenuItem } from '../../ui/menu.ts';
import { emptyState } from '../../ui/states.ts';
import { widgetFrame } from '../../ui/widget-frame.ts';
import { createWidgetSlot } from './widget-slot.ts';

export interface HostItem {
  readonly root: HTMLElement;
  /** Applies width and position, the config is owned by the item once created. */
  update(instance: WidgetInstance, index: number, count: number): void;
  refresh(reason: RefreshReason): void;
  dispose(): void;
}

export interface InstanceItemOptions {
  readonly instance: WidgetInstance;
  /** Undefined for types this version does not know, e.g. stored by a newer version. */
  readonly definition: ErasedWidgetDefinition | undefined;
  readonly data: WidgetData;
  readonly openOptions: () => void;
  readonly reportError: (error: unknown) => void;
  readonly startInConfig?: boolean;
  readonly persistConfig: (id: string, config: unknown) => Promise<void>;
  readonly onToggleWidth: (id: string) => void;
  readonly onMove: (id: string, offset: number) => void;
  readonly onRemove: (id: string) => void;
}

export const ITEM_CLASS = 'ghx-host-item';
export const FULL_WIDTH_CLASS = 'ghx-host-item--full';

const LABELS = {
  refresh: 'Refresh',
  configure: 'Configure',
  width: 'Toggle width',
  up: 'Move up',
  down: 'Move down',
  remove: 'Remove',
} as const;

function applyInstance(root: HTMLElement, instance: WidgetInstance): void {
  root.dataset['instanceId'] = instance.id;
  root.classList.toggle(FULL_WIDTH_CLASS, instance.width === 'full');
}

export function createInstanceItem(options: InstanceItemOptions): HostItem {
  return options.definition === undefined
    ? createUnknownItem(options)
    : createKnownItem(options, options.definition);
}

function createKnownItem(
  options: InstanceItemOptions,
  definition: ErasedWidgetDefinition,
): HostItem {
  const { id } = options.instance;
  const entries: (MenuItem | null)[] = [
    { label: LABELS.refresh, icon: 'sync', onSelect: () => slot.refresh('manual') },
    definition.renderConfig === null
      ? null
      : { label: LABELS.configure, icon: 'gear', onSelect: () => slot.configure() },
    { label: LABELS.width, onSelect: () => options.onToggleWidth(id) },
    { label: LABELS.up, icon: 'chevron-up', onSelect: () => options.onMove(id, -1) },
    { label: LABELS.down, icon: 'chevron-down', onSelect: () => options.onMove(id, 1) },
    'separator',
    {
      label: LABELS.remove,
      icon: 'trash',
      variant: 'danger',
      onSelect: () => options.onRemove(id),
    },
  ];
  const items = entries.filter((item) => item !== null);
  const menu = dropdownMenu({ label: 'Widget actions', items, align: 'end' });
  const actions = items.filter((item) => item !== 'separator');
  // The menu renders one button per action, in order.
  const menuButton = (label: string): HTMLButtonElement =>
    menu.menu
      .querySelectorAll('button')
      .item(actions.findIndex((action) => action.label === label));
  const upButton = menuButton(LABELS.up);
  const downButton = menuButton(LABELS.down);
  const widthButton = menuButton(LABELS.width);

  const slot = createWidgetSlot({
    definition,
    instanceId: id,
    config: options.instance.config,
    data: options.data,
    openOptions: options.openOptions,
    persistConfig: (config) => options.persistConfig(id, config),
    reportError: options.reportError,
    startInConfig: options.startInConfig ?? false,
    actions: [menu.root],
    className: ITEM_CLASS,
  });
  const { root } = slot.frame;

  return {
    root,
    update(instance, index, count) {
      applyInstance(root, instance);
      upButton.disabled = index === 0;
      downButton.disabled = index === count - 1;
      widthButton.replaceChildren(
        h('span', null, instance.width === 'full' ? 'Use half width' : 'Use full width'),
      );
    },
    refresh: (reason) => slot.refresh(reason),
    dispose() {
      menu.close();
      slot.dispose();
    },
  };
}

function createUnknownItem(options: InstanceItemOptions): HostItem {
  const { id, type } = options.instance;
  const frame = widgetFrame({
    title: 'Unknown widget',
    icon: 'alert',
    className: ITEM_CLASS,
    actions: [
      iconButton({ icon: 'trash', label: 'Remove widget', onClick: () => options.onRemove(id) }),
    ],
    body: emptyState({
      title: 'This widget is not available',
      description: `The widget type "${type}" is not supported by this version of the extension.`,
    }),
  });
  return {
    root: frame.root,
    update: (instance) => applyInstance(frame.root, instance),
    refresh: () => undefined,
    dispose: () => undefined,
  };
}
