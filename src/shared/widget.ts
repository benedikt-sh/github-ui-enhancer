import type { WidgetData } from './data.ts';

export type Dispose = () => void;

export type RefreshReason = 'interval' | 'manual' | 'visible';

export interface WidgetContext<C> {
  readonly instanceId: string;
  readonly data: WidgetData;
  /** Aborted when the instance is disposed, e.g. to cancel pending renders. */
  readonly signal: AbortSignal;
  /** Persists the config without remounting the instance. */
  saveConfig(config: C): Promise<void>;
  /** `manual` refreshes should bypass the cache (`forceRefresh`). */
  onRefresh(listener: (reason: RefreshReason) => void): Dispose;
  openOptions(): void;
}

export interface ConfigFormContext<C> {
  readonly config: C;
  readonly data: WidgetData;
  readonly signal: AbortSignal;
  /** The host stores the config and remounts the instance with it. */
  submit(config: C): void;
  cancel(): void;
}

export interface WidgetPreset<C> {
  readonly id: string;
  readonly title: string;
  readonly config: C;
}

export interface WidgetDefinition<C> {
  readonly type: string;
  readonly title: string;
  readonly description: string;
  /** Singleton widgets exist exactly once and cannot be added, removed or moved. */
  readonly singleton: boolean;
  /** Offered in the "add widget" menu in addition to the default config. */
  readonly presets: readonly WidgetPreset<C>[];
  defaultConfig(): C;
  /** Must accept any stored value and fall back to defaults for invalid parts. */
  parseConfig(raw: unknown): C;
  instanceTitle(config: C): string;
  mount(target: HTMLElement, context: WidgetContext<C>, config: C): Dispose;
  /** Null for widgets without settings. */
  readonly renderConfig: ((target: HTMLElement, context: ConfigFormContext<C>) => Dispose) | null;
}

/** Type-erased definition so the host can keep widgets with different configs in one list. */
export interface ErasedWidgetDefinition {
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly singleton: boolean;
  readonly presets: readonly WidgetPreset<unknown>[];
  defaultConfig(): unknown;
  parseConfig(raw: unknown): unknown;
  instanceTitle(raw: unknown): string;
  mount(target: HTMLElement, context: WidgetContext<unknown>, raw: unknown): Dispose;
  readonly renderConfig:
    | ((target: HTMLElement, context: ConfigFormContext<unknown>) => Dispose)
    | null;
}

export function eraseWidget<C>(definition: WidgetDefinition<C>): ErasedWidgetDefinition {
  const { renderConfig } = definition;
  return {
    type: definition.type,
    title: definition.title,
    description: definition.description,
    singleton: definition.singleton,
    presets: definition.presets,
    defaultConfig: () => definition.defaultConfig(),
    parseConfig: (raw) => definition.parseConfig(raw),
    instanceTitle: (raw) => definition.instanceTitle(definition.parseConfig(raw)),
    mount: (target, context, raw) =>
      definition.mount(target, context, definition.parseConfig(raw)),
    renderConfig:
      renderConfig === null
        ? null
        : (target, context) =>
            renderConfig(target, {
              config: definition.parseConfig(context.config),
              data: context.data,
              signal: context.signal,
              submit: (config) => context.submit(config),
              cancel: () => context.cancel(),
            }),
  };
}
