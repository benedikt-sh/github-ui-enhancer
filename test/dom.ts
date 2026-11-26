import { Window } from 'happy-dom';

export interface DomEnvironment {
  readonly window: Window;
  /** Restores the previous globals and closes the window. */
  cleanup(): Promise<void>;
}

const GLOBAL_NAMES = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'customElements',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'HTMLFormElement',
  'HTMLTemplateElement',
  'SVGElement',
  'Text',
  'DocumentFragment',
  'DOMParser',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'SubmitEvent',
  'PopStateEvent',
] as const;

/**
 * Exposes a happy-dom window as globals, so code under test can use `document` and friends
 * like in the browser. Node's own `Event` and `navigator` are shadowed until `cleanup`.
 */
export function installDom(url = 'https://github.com/'): DomEnvironment {
  const window = new Window({ url, width: 1280, height: 800 });
  const source = window as unknown as Record<string, unknown>;
  const target = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const name of GLOBAL_NAMES) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : source[name];
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value,
    });
  }

  return {
    window,
    async cleanup() {
      for (const [name, descriptor] of previous) {
        if (descriptor === undefined) {
          delete target[name];
        } else {
          Object.defineProperty(target, name, descriptor);
        }
      }
      await window.happyDOM.close();
    },
  };
}
