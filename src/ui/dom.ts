export type Child = Node | string | number | false | null | undefined | readonly Child[];

export type ClassValue = string | false | null | undefined | readonly ClassValue[];

export type AttributeValue = string | number | boolean | null | undefined;

export type StyleMap = Readonly<Record<string, string | undefined>>;

export type Listeners<M> = { readonly [K in keyof M]?: (event: M[K]) => void };

/**
 * Every key other than the reserved ones becomes an attribute. `true` sets an empty attribute,
 * `false`, `null` and `undefined` leave it out.
 */
export interface Props<M> {
  readonly className?: ClassValue;
  readonly dataset?: StyleMap | undefined;
  /** Keys in camelCase or kebab-case, custom properties (`--name`) are passed through. */
  readonly style?: StyleMap | undefined;
  readonly on?: Listeners<M> | undefined;
  readonly [attribute: string]: AttributeValue | ClassValue | StyleMap | Listeners<M>;
}

export type HtmlProps = Props<HTMLElementEventMap>;
export type SvgProps = Props<SVGElementEventMap>;

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const RESERVED = new Set(['className', 'dataset', 'style', 'on']);

export function classNames(...values: ClassValue[]): string {
  const result: string[] = [];
  const visit = (value: ClassValue): void => {
    if (typeof value === 'string') {
      result.push(...value.split(/\s+/).filter((part) => part !== ''));
    } else if (Array.isArray(value)) {
      for (const item of value as readonly ClassValue[]) {
        visit(item);
      }
    }
  };
  values.forEach(visit);
  return result.join(' ');
}

function toCssProperty(name: string): string {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function applyProps<M>(element: HTMLElement | SVGElement, props: Props<M>): void {
  for (const [name, value] of Object.entries(props)) {
    if (RESERVED.has(name)) {
      continue;
    }
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      element.setAttribute(name, '');
    } else if (typeof value === 'string' || typeof value === 'number') {
      element.setAttribute(name, String(value));
    } else {
      throw new TypeError(`Unsupported value for attribute "${name}"`);
    }
  }

  const className = classNames(props.className);
  if (className !== '') {
    element.setAttribute('class', className);
  }
  for (const [key, value] of Object.entries(props.dataset ?? {})) {
    if (value !== undefined) {
      element.dataset[key] = value;
    }
  }
  for (const [key, value] of Object.entries(props.style ?? {})) {
    if (value !== undefined) {
      element.style.setProperty(toCssProperty(key), value);
    }
  }
  // The mapped listener type cannot be narrowed per entry, the keys come from the event map.
  for (const [type, listener] of Object.entries(props.on ?? {}) as [string, EventListener][]) {
    element.addEventListener(type, listener);
  }
}

export function appendChildren(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (Array.isArray(child)) {
      appendChildren(parent, child as readonly Child[]);
    } else if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child as Node);
    }
  }
}

/** Creates an HTML element. Strings always become text nodes, so data is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: HtmlProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    applyProps(element, props);
  }
  appendChildren(element, children);
  return element;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: SvgProps | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  if (props) {
    applyProps(element, props);
  }
  appendChildren(element, children);
  return element;
}

let idCounter = 0;

/** Ids for `aria-*` and `for` references, unique within the page. */
export function uniqueId(prefix = 'ghx'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Only http(s) URLs may become links, so a crafted `javascript:` URL from data is never used. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
