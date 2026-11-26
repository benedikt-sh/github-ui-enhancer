import { appendChildren, h, uniqueId } from './dom.ts';
import type { Child, ClassValue } from './dom.ts';
import { icon } from './octicons.ts';
import type { IconName } from './octicons.ts';

export interface WidgetFrameOptions {
  readonly title: string;
  readonly icon?: IconName;
  readonly subtitle?: string | null;
  readonly count?: number | null;
  /** Buttons or menus at the right end of the header. */
  readonly actions?: readonly Node[];
  readonly body?: Child;
  readonly className?: ClassValue;
}

export interface WidgetFrame {
  readonly root: HTMLElement;
  readonly header: HTMLElement;
  readonly actions: HTMLElement;
  readonly body: HTMLElement;
  setTitle(title: string): void;
  setSubtitle(subtitle: string | null): void;
  setCount(count: number | null): void;
  /** Replaces the body content, e.g. to switch between loading, list and error. */
  setBody(...children: Child[]): void;
}

export function widgetFrame(options: WidgetFrameOptions): WidgetFrame {
  const titleId = uniqueId('ghx-widget-title');
  const title = h('span', { className: 'ghx-widget__title-text' }, options.title);
  const count = h('span', { className: 'ghx-counter', hidden: true });
  const subtitle = h('p', { className: 'ghx-widget__subtitle', hidden: true });
  const actions = h('div', { className: 'ghx-widget__actions' }, options.actions ?? []);
  const header = h(
    'header',
    { className: 'ghx-widget__header' },
    h(
      'div',
      { className: 'ghx-widget__heading' },
      h(
        'h2',
        { className: 'ghx-widget__title', id: titleId },
        options.icon ? icon(options.icon) : null,
        title,
        count,
      ),
      subtitle,
    ),
    actions,
  );
  const body = h('div', { className: 'ghx-widget__body' }, options.body);
  const root = h(
    'section',
    { className: ['ghx-widget', options.className], 'aria-labelledby': titleId },
    header,
    body,
  );

  const frame: WidgetFrame = {
    root,
    header,
    actions,
    body,
    setTitle(text) {
      title.textContent = text;
    },
    setSubtitle(text) {
      subtitle.textContent = text ?? '';
      subtitle.hidden = !text;
    },
    setCount(value) {
      count.textContent = value === null ? '' : String(value);
      count.hidden = value === null;
    },
    setBody(...children) {
      body.replaceChildren();
      appendChildren(body, children);
    },
  };
  frame.setSubtitle(options.subtitle ?? null);
  frame.setCount(options.count ?? null);
  return frame;
}
