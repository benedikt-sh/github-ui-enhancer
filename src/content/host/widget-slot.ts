import type { WidgetData } from '../../shared/data.ts';
import type {
  ConfigFormContext,
  Dispose,
  ErasedWidgetDefinition,
  RefreshReason,
  WidgetContext,
} from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import type { ClassValue } from '../../ui/dom.ts';
import { button } from '../../ui/forms.ts';
import { errorState } from '../../ui/states.ts';
import { widgetFrame } from '../../ui/widget-frame.ts';
import type { WidgetFrame } from '../../ui/widget-frame.ts';

export interface WidgetSlotOptions {
  readonly definition: ErasedWidgetDefinition;
  readonly instanceId: string;
  readonly config: unknown;
  readonly data: WidgetData;
  readonly openOptions: () => void;
  /** Stores the config. Must not reject, storage failures are the caller's business. */
  readonly persistConfig: (config: unknown) => Promise<void>;
  readonly reportError: (error: unknown) => void;
  /** Opens the config form instead of mounting the widget, e.g. right after adding it. */
  readonly startInConfig?: boolean;
  readonly actions?: readonly Node[];
  readonly className?: ClassValue;
}

export type SlotMode = 'widget' | 'config' | 'error';

export interface WidgetSlot {
  readonly frame: WidgetFrame;
  readonly mode: SlotMode;
  readonly config: unknown;
  readonly configurable: boolean;
  refresh(reason: RefreshReason): void;
  /** Replaces the widget with its config form. Does nothing without a form. */
  configure(): void;
  dispose(): void;
}

interface Session {
  readonly controller: AbortController;
  readonly listeners: Set<(reason: RefreshReason) => void>;
  dispose: Dispose | null;
}

/** Runs one widget inside a frame, isolating the rest of the page from its failures. */
export function createWidgetSlot(options: WidgetSlotOptions): WidgetSlot {
  const { definition, instanceId, data, openOptions, persistConfig, reportError } = options;
  const { renderConfig } = definition;
  let config = options.config;
  let mode: SlotMode = 'widget';
  let session: Session | null = null;
  let disposed = false;

  const titleOf = (value: unknown): string => {
    try {
      return definition.instanceTitle(value);
    } catch (error) {
      reportError(error);
      return definition.title;
    }
  };

  const frame = widgetFrame({
    title: titleOf(config),
    actions: options.actions ?? [],
    className: options.className,
  });

  function storeConfig(next: unknown): Promise<void> {
    config = next;
    frame.setTitle(titleOf(next));
    return persistConfig(next);
  }

  function endSession(): void {
    const current = session;
    session = null;
    if (current === null) {
      return;
    }
    current.controller.abort();
    try {
      current.dispose?.();
    } catch (error) {
      reportError(error);
    }
  }

  function startSession(nextMode: SlotMode): Session {
    endSession();
    frame.setBody();
    mode = nextMode;
    const current: Session = {
      controller: new AbortController(),
      listeners: new Set(),
      dispose: null,
    };
    session = current;
    return current;
  }

  function showError(error: unknown, title: string, onRetry: () => void, extra?: Node): void {
    reportError(error);
    endSession();
    mode = 'error';
    const state = errorState([], { title, onRetry });
    if (extra) {
      state.querySelector('.ghx-state__actions')?.append(extra);
    }
    frame.setBody(state);
  }

  function mount(): void {
    const current = startSession('widget');
    const context: WidgetContext<unknown> = {
      instanceId,
      data,
      signal: current.controller.signal,
      saveConfig: (next) => (session === current ? storeConfig(next) : Promise.resolve()),
      onRefresh(listener) {
        current.listeners.add(listener);
        return () => {
          current.listeners.delete(listener);
        };
      },
      openOptions,
    };
    try {
      current.dispose = definition.mount(frame.body, context, config);
    } catch (error) {
      showError(error, 'This widget could not be displayed', mount);
    }
  }

  function openConfig(): void {
    if (renderConfig === null) {
      return;
    }
    const current = startSession('config');
    const target = h('div', { className: 'ghx-host-config' });
    frame.setBody(target);
    const finish = (apply: boolean, next?: unknown): void => {
      if (session !== current) {
        return;
      }
      if (apply) {
        void storeConfig(next);
      }
      mount();
    };
    const context: ConfigFormContext<unknown> = {
      config,
      data,
      signal: current.controller.signal,
      submit: (next) => finish(true, next),
      cancel: () => finish(false),
    };
    try {
      current.dispose = renderConfig(target, context);
    } catch (error) {
      const back = button({ label: 'Back to widget', size: 'small', onClick: mount });
      showError(error, 'The settings could not be displayed', openConfig, back);
    }
  }

  if (options.startInConfig && renderConfig !== null) {
    openConfig();
  } else {
    mount();
  }

  return {
    frame,
    get mode() {
      return mode;
    },
    get config() {
      return config;
    },
    configurable: renderConfig !== null,
    refresh(reason) {
      if (!disposed && mode === 'error' && reason === 'manual') {
        mount();
        return;
      }
      if (disposed || mode !== 'widget' || session === null) {
        return;
      }
      for (const listener of [...session.listeners]) {
        try {
          listener(reason);
        } catch (error) {
          reportError(error);
        }
      }
    },
    configure() {
      if (!disposed && mode !== 'config') {
        openConfig();
      }
    },
    dispose() {
      disposed = true;
      endSession();
    },
  };
}
