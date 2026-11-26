import type {
  ConfigFormContext,
  ErasedWidgetDefinition,
  RefreshReason,
  WidgetContext,
} from '../../shared/widget.ts';
import type { Clock, Timers, VisibilitySource } from './refresh-scheduler.ts';

export interface FakeTime extends Timers {
  readonly clock: Clock;
  /** Advances the clock and runs every timer that became due. */
  advance(ms: number): void;
  pending(): number;
}

export function createFakeTime(start = 0): FakeTime {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { due: number; callback: () => void }>();

  return {
    clock: () => now,
    schedule(callback, ms) {
      const id = nextId++;
      timers.set(id, { due: now + ms, callback });
      return () => timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (due === undefined) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].due;
        due[1].callback();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

export interface FakeVisibility extends VisibilitySource {
  set(visible: boolean): void;
  listenerCount(): number;
}

export function createFakeVisibility(visible = true): FakeVisibility {
  let current = visible;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      current = value;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listenerCount: () => listeners.size,
  };
}

export interface FakeConfig {
  readonly name: string;
}

export interface MountRecord {
  readonly target: HTMLElement;
  readonly context: WidgetContext<unknown>;
  readonly config: unknown;
  readonly refreshes: RefreshReason[];
  disposed: boolean;
}

export interface FormRecord {
  readonly target: HTMLElement;
  readonly context: ConfigFormContext<unknown>;
  disposed: boolean;
}

export interface FakeWidget extends ErasedWidgetDefinition {
  readonly mounts: MountRecord[];
  readonly forms: FormRecord[];
  /** The latest mount that has not been disposed yet. */
  active(): MountRecord | undefined;
}

export interface FakeWidgetOptions {
  readonly type?: string;
  readonly title?: string;
  readonly singleton?: boolean;
  readonly configurable?: boolean;
  readonly presets?: ErasedWidgetDefinition['presets'];
  readonly mountError?: () => Error | null;
  readonly formError?: () => Error | null;
  readonly disposeError?: Error;
}

const configName = (raw: unknown): string =>
  typeof raw === 'object' && raw !== null && 'name' in raw && typeof raw.name === 'string'
    ? raw.name
    : 'default';

export function createFakeWidget(options: FakeWidgetOptions = {}): FakeWidget {
  const mounts: MountRecord[] = [];
  const forms: FormRecord[] = [];
  const title = options.title ?? 'Fake list';
  return {
    type: options.type ?? 'fake-list',
    title,
    description: `${title} description`,
    singleton: options.singleton ?? false,
    presets: options.presets ?? [],
    mounts,
    forms,
    active: () => mounts.filter((record) => !record.disposed).at(-1),
    defaultConfig: () => ({ name: 'default' }),
    parseConfig: (raw) => ({ name: configName(raw) }),
    instanceTitle: (raw) => `${title}: ${configName(raw)}`,
    mount(target, context, config) {
      const error = options.mountError?.() ?? null;
      if (error !== null) {
        throw error;
      }
      const record: MountRecord = { target, context, config, refreshes: [], disposed: false };
      mounts.push(record);
      target.append(`content ${configName(config)}`);
      context.onRefresh((reason) => record.refreshes.push(reason));
      return () => {
        record.disposed = true;
        if (options.disposeError) {
          throw options.disposeError;
        }
      };
    },
    renderConfig: options.configurable
      ? (target, context) => {
          const error = options.formError?.() ?? null;
          if (error !== null) {
            throw error;
          }
          const record: FormRecord = { target, context, disposed: false };
          forms.push(record);
          target.append('config form');
          return () => {
            record.disposed = true;
          };
        }
      : null,
  };
}
