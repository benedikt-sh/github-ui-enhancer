import type { WidgetData } from '../../shared/data.ts';
import { isRecord } from '../../shared/guards.ts';
import { createId as createRandomId, parseLayout } from '../../shared/layout.ts';
import type { DashboardLayout, WidgetInstance } from '../../shared/layout.ts';
import { STORAGE_KEYS } from '../../shared/storage.ts';
import type { KeyValueStore } from '../../shared/storage.ts';
import type { TokenInfo } from '../../shared/tokens.ts';
import type { ErasedWidgetDefinition, RefreshReason, WidgetPreset } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { button, notice } from '../../ui/forms.ts';
import { dropdownMenu } from '../../ui/menu.ts';
import type { MenuItem } from '../../ui/menu.ts';
import { emptyState, loadingState } from '../../ui/states.ts';
import { createInstanceItem } from './instance-item.ts';
import type { HostItem } from './instance-item.ts';
import {
  addInstance,
  moveInstance,
  removeInstance,
  setInstanceConfig,
  toggleWidth,
} from './layout-ops.ts';
import {
  createRefreshScheduler,
  DEFAULT_REFRESH_INTERVAL_MS,
  documentVisibility,
  windowTimers,
} from './refresh-scheduler.ts';
import type { Clock, Timers, VisibilitySource } from './refresh-scheduler.ts';
import { findTokenProblems, tokenNotice } from './token-notice.ts';
import { createWidgetSlot } from './widget-slot.ts';
import type { WidgetSlot } from './widget-slot.ts';

export type HostView = 'dashboard' | 'original';

/**
 * Singleton configs live next to the layout because singletons are not part of it. The key is
 * local to the host until it is added to `STORAGE_KEYS`.
 */
export const SINGLETON_CONFIG_KEY = 'singletons';

export interface DashboardHostOptions {
  /** Element provided by the mount controller, the host appends its own container to it. */
  readonly root: HTMLElement;
  readonly widgets: readonly ErasedWidgetDefinition[];
  readonly data: WidgetData;
  /** `storage.sync`, holds the layout and the singleton configs. */
  readonly layoutStore: KeyValueStore;
  readonly defaultLayout: () => DashboardLayout;
  readonly loadTokens: () => Promise<readonly TokenInfo[]>;
  /** Login of the user signed in on github.com, null if unknown. */
  readonly pageLogin: string | null;
  readonly openOptions: () => void;
  /** Called when the user switches views. The host has already switched itself. */
  readonly onViewChange: (view: HostView) => void;
  readonly initialView?: HostView;
  readonly title?: string;
  readonly refreshIntervalMs?: number;
  /** Defaults to the timers of the root's window. */
  readonly timers?: Timers;
  /** Defaults to the visibility of the root's document. */
  readonly visibility?: VisibilitySource;
  readonly clock?: Clock;
  readonly createId?: () => string;
  /** Widget failures and storage errors, e.g. for logging. Defaults to ignoring them. */
  readonly reportError?: (error: unknown) => void;
}

export interface DashboardHost {
  readonly view: HostView;
  /** Resolves once the layout is loaded and rendered. */
  readonly ready: Promise<void>;
  /** Switches without calling `onViewChange`, for changes that did not start in the host. */
  setView(view: HostView): void;
  refreshAll(): void;
  dispose(): void;
}

const ignore = (): void => undefined;

function requireWindow(document: Document): Window {
  const { defaultView } = document;
  if (defaultView === null) {
    throw new Error('The dashboard root must belong to a document with a window');
  }
  return defaultView;
}

export function createDashboardHost(options: DashboardHostOptions): DashboardHost {
  const { root, data, layoutStore, openOptions, pageLogin } = options;
  const document = root.ownerDocument;
  const definitions = new Map(options.widgets.map((definition) => [definition.type, definition]));
  const reportError = options.reportError ?? ignore;
  const clock = options.clock ?? ((): number => Date.now());
  const createId = options.createId ?? createRandomId;

  let view: HostView = options.initialView ?? 'dashboard';
  let layout: DashboardLayout | null = null;
  let singletonConfigs: Record<string, unknown> = {};
  let disposed = false;
  let saveQueue: Promise<void> = Promise.resolve();
  let tokenRequest = 0;
  const items = new Map<string, HostItem>();
  const singletons: WidgetSlot[] = [];
  const openConfigFor = new Set<string>();

  const backButton = button({
    label: 'Back to dashboard',
    size: 'small',
    onClick: () => changeView('dashboard'),
  });
  const originalBar = h(
    'div',
    { className: 'ghx-host-bar' },
    h('span', { className: 'ghx-host-bar__text' }, "You are viewing GitHub's original page."),
    backButton,
  );

  const addMenu = dropdownMenu({
    label: 'Add widget',
    text: 'Add widget',
    items: addMenuItems(),
    align: 'end',
  });
  addMenu.trigger.disabled = true;
  const toolbar = h(
    'header',
    { className: 'ghx-host-toolbar' },
    h('h1', { className: 'ghx-host-toolbar__title' }, options.title ?? 'Dashboard'),
    h(
      'div',
      { className: 'ghx-host-toolbar__actions' },
      button({ label: 'Refresh all', icon: 'sync', size: 'small', onClick: refreshAll }),
      addMenu.root,
      button({
        label: "Show GitHub's page",
        icon: 'eye',
        size: 'small',
        variant: 'invisible',
        onClick: () => changeView('original'),
      }),
    ),
  );
  const tokenArea = h('div', { className: 'ghx-host-tokens' });
  const saveArea = h('div', { className: 'ghx-host-save' });
  const singletonArea = h('div', { className: 'ghx-host-singletons' });
  const grid = h('div', { className: 'ghx-host-grid' }, loadingState('Loading dashboard...'));
  const emptyLayout = emptyState({
    icon: 'plus',
    title: 'Your dashboard is empty',
    description: 'Use "Add widget" to place pull requests, issues or workflow runs here.',
  });
  const dashboard = h(
    'div',
    { className: 'ghx-host-dashboard' },
    toolbar,
    h('div', { className: 'ghx-host-notices' }, tokenArea, saveArea),
    singletonArea,
    grid,
  );
  const container = h('div', { className: 'ghx-host' }, originalBar, dashboard);
  root.append(container);

  const scheduler = createRefreshScheduler({
    intervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    timers: options.timers ?? windowTimers(requireWindow(document)),
    visibility: options.visibility ?? documentVisibility(document),
    clock,
    isActive: () => view === 'dashboard',
    onRefresh: refreshEverything,
  });

  applyView();
  loadTokenNotice();
  const singletonsReady = loadSingletons();
  const ready = Promise.all([singletonsReady, loadLayout()]).then(() => undefined);

  function addMenuItems(): MenuItem[] {
    const addable = options.widgets.filter((definition) => !definition.singleton);
    if (addable.length === 0) {
      return [{ label: 'No widgets available', disabled: true, onSelect: ignore }];
    }
    return addable.flatMap((definition, index): MenuItem[] => [
      ...(index > 0 ? ['separator' as const] : []),
      { label: definition.title, onSelect: () => addWidget(definition, null) },
      ...definition.presets.map((preset) => ({
        label: `${definition.title}: ${preset.title}`,
        onSelect: () => addWidget(definition, preset),
      })),
    ]);
  }

  function changeView(next: HostView): void {
    if (next !== view) {
      setView(next);
      options.onViewChange(next);
    }
  }

  function setView(next: HostView): void {
    if (disposed || next === view) {
      return;
    }
    view = next;
    applyView();
    if (view === 'dashboard') {
      scheduler.resume();
    } else {
      addMenu.close();
    }
  }

  function applyView(): void {
    container.dataset['view'] = view;
    originalBar.hidden = view !== 'original';
    dashboard.hidden = view !== 'dashboard';
  }

  function refreshAll(): void {
    scheduler.refreshNow();
  }

  function refreshEverything(reason: RefreshReason): void {
    for (const slot of singletons) {
      slot.refresh(reason);
    }
    for (const item of items.values()) {
      item.refresh(reason);
    }
    loadTokenNotice();
  }

  function loadTokenNotice(): void {
    tokenRequest += 1;
    const request = tokenRequest;
    const isCurrent = (): boolean => !disposed && request === tokenRequest;
    Promise.resolve()
      .then(() => options.loadTokens())
      .then(
        (tokens) => {
          if (isCurrent()) {
            const problems = findTokenProblems(tokens, pageLogin, clock());
            tokenArea.replaceChildren(...(problems ? [tokenNotice(problems, openOptions)] : []));
          }
        },
        (error: unknown) => {
          reportError(error);
          if (isCurrent()) {
            tokenArea.replaceChildren();
          }
        },
      );
  }

  /** Writes run one after another, so an older layout never overwrites a newer one. */
  function persist(key: string, value: unknown): Promise<void> {
    const write = saveQueue
      .then(() => layoutStore.set(key, value))
      .then(
        () => showSaveError(false),
        (error: unknown) => {
          reportError(error);
          showSaveError(true);
        },
      );
    saveQueue = write;
    return write;
  }

  function showSaveError(failed: boolean): void {
    saveArea.replaceChildren(
      ...(failed
        ? [
            notice({
              variant: 'danger',
              title: 'Changes could not be saved',
              message: 'The dashboard layout could not be stored and may be lost on reload.',
            }),
          ]
        : []),
    );
  }

  async function loadSingletons(): Promise<void> {
    const definitionsToMount = options.widgets.filter((definition) => definition.singleton);
    if (definitionsToMount.length === 0) {
      return;
    }
    try {
      const raw = await layoutStore.get(SINGLETON_CONFIG_KEY);
      singletonConfigs = isRecord(raw) ? { ...raw } : {};
    } catch (error) {
      reportError(error);
    }
    if (disposed) {
      return;
    }
    for (const definition of definitionsToMount) {
      const { type } = definition;
      const slot = createWidgetSlot({
        definition,
        instanceId: type,
        config: Object.hasOwn(singletonConfigs, type)
          ? singletonConfigs[type]
          : definition.defaultConfig(),
        data,
        openOptions,
        reportError,
        persistConfig: (config) => {
          singletonConfigs = { ...singletonConfigs, [type]: config };
          return persist(SINGLETON_CONFIG_KEY, singletonConfigs);
        },
        className: 'ghx-host-singleton',
      });
      singletons.push(slot);
      singletonArea.append(slot.frame.root);
    }
  }

  async function loadLayout(): Promise<void> {
    let loaded: DashboardLayout | null = null;
    let readFailed = false;
    try {
      loaded = parseLayout(await layoutStore.get(STORAGE_KEYS.layout));
    } catch (error) {
      reportError(error);
      readFailed = true;
    }
    if (disposed) {
      return;
    }
    if (loaded === null) {
      loaded = options.defaultLayout();
      // An unreadable store may still hold the user's layout, so only replace a missing one.
      if (!readFailed) {
        void persist(STORAGE_KEYS.layout, loaded);
      }
    }
    layout = loaded;
    addMenu.trigger.disabled = false;
    render();
  }

  function commit(update: (current: DashboardLayout) => DashboardLayout): Promise<void> {
    if (layout === null || disposed) {
      return Promise.resolve();
    }
    const next = update(layout);
    if (next === layout) {
      return Promise.resolve();
    }
    layout = next;
    render();
    return persist(STORAGE_KEYS.layout, next);
  }

  function addWidget(
    definition: ErasedWidgetDefinition,
    preset: WidgetPreset<unknown> | null,
  ): void {
    if (layout === null) {
      return;
    }
    const instance: WidgetInstance = {
      id: createId(),
      type: definition.type,
      width: 'half',
      config: preset === null ? definition.defaultConfig() : preset.config,
    };
    if (preset === null && definition.renderConfig !== null) {
      openConfigFor.add(instance.id);
    }
    void commit((current) => addInstance(current, instance));
    items.get(instance.id)?.root.scrollIntoView({ block: 'nearest' });
  }

  function createItem(instance: WidgetInstance): HostItem {
    const startInConfig = openConfigFor.delete(instance.id);
    return createInstanceItem({
      instance,
      definition: definitions.get(instance.type),
      data,
      openOptions,
      reportError,
      startInConfig,
      persistConfig: (id, config) => commit((current) => setInstanceConfig(current, id, config)),
      onToggleWidth: (id) => void commit((current) => toggleWidth(current, id)),
      onMove: (id, offset) => void commit((current) => moveInstance(current, id, offset)),
      onRemove: (id) => void commit((current) => removeInstance(current, id)),
    });
  }

  /** Keeps existing widgets mounted and only moves their nodes, so nothing refetches. */
  function render(): void {
    const instances = layout?.instances ?? [];
    const ids = new Set(instances.map((instance) => instance.id));
    for (const [id, item] of items) {
      if (!ids.has(id)) {
        items.delete(id);
        item.dispose();
        item.root.remove();
      }
    }
    if (instances.length === 0) {
      grid.replaceChildren(emptyLayout);
      return;
    }
    emptyLayout.remove();
    grid.querySelector('.ghx-state--loading')?.remove();
    const focused = document.activeElement;
    instances.forEach((instance, index) => {
      let item = items.get(instance.id);
      if (item === undefined) {
        item = createItem(instance);
        items.set(instance.id, item);
      }
      item.update(instance, index, instances.length);
      const current = grid.children.item(index);
      if (current !== item.root) {
        grid.insertBefore(item.root, current);
      }
    });
    if (focused instanceof HTMLElement && focused !== document.activeElement) {
      focused.focus();
    }
  }

  return {
    get view() {
      return view;
    },
    ready,
    setView,
    refreshAll,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      scheduler.dispose();
      addMenu.close();
      for (const slot of singletons) {
        slot.dispose();
      }
      for (const item of items.values()) {
        item.dispose();
      }
      singletons.length = 0;
      items.clear();
      container.remove();
    },
  };
}
