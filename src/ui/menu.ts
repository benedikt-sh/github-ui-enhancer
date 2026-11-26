import { h, uniqueId } from './dom.ts';
import type { ClassValue } from './dom.ts';
import { icon } from './octicons.ts';
import type { IconName } from './octicons.ts';

export interface MenuAction {
  readonly label: string;
  readonly icon?: IconName;
  readonly variant?: 'default' | 'danger';
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export type MenuItem = MenuAction | 'separator';

export interface DropdownMenuOptions {
  /** Accessible name of the trigger button. */
  readonly label: string;
  /** Visible trigger text. Without it the trigger is an icon button. */
  readonly text?: string;
  readonly icon?: IconName;
  readonly items: readonly MenuItem[];
  /** Which trigger edge the menu aligns to. */
  readonly align?: 'start' | 'end';
  readonly className?: ClassValue;
}

export interface DropdownMenu {
  readonly root: HTMLDivElement;
  readonly trigger: HTMLButtonElement;
  readonly menu: HTMLUListElement;
  isOpen(): boolean;
  open(focus?: 'first' | 'last'): void;
  close(options?: { restoreFocus?: boolean }): void;
}

export function dropdownMenu(options: DropdownMenuOptions): DropdownMenu {
  const menuId = uniqueId('ghx-menu');
  const triggerIcon = options.icon ?? (options.text ? 'chevron-down' : 'kebab-horizontal');
  const trigger = h(
    'button',
    {
      type: 'button',
      className: [
        'ghx-btn',
        options.text ? 'ghx-btn--default' : ['ghx-btn--invisible', 'ghx-btn--icon'],
      ],
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': menuId,
      'aria-label': options.text ? undefined : options.label,
      title: options.text ? undefined : options.label,
    },
    options.text ? h('span', { className: 'ghx-btn__label' }, options.text) : null,
    icon(triggerIcon),
  );

  const itemButtons: HTMLButtonElement[] = [];
  const entries = options.items.map((item) => {
    if (item === 'separator') {
      return h('li', { className: 'ghx-menu__separator', role: 'separator' });
    }
    const itemButton = h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        tabindex: -1,
        className: ['ghx-menu__item', item.variant === 'danger' && 'ghx-menu__item--danger'],
        disabled: item.disabled,
        on: {
          click: () => {
            close({ restoreFocus: true });
            item.onSelect();
          },
        },
      },
      item.icon ? icon(item.icon) : null,
      h('span', null, item.label),
    );
    itemButtons.push(itemButton);
    return h('li', { role: 'none' }, itemButton);
  });

  const menu = h(
    'ul',
    {
      className: ['ghx-menu', options.align === 'start' ? 'ghx-menu--start' : 'ghx-menu--end'],
      id: menuId,
      role: 'menu',
      'aria-label': options.label,
      hidden: true,
    },
    entries,
  );
  const root = h('div', { className: ['ghx-dropdown', options.className] }, trigger, menu);

  const enabledItems = (): HTMLButtonElement[] => itemButtons.filter((item) => !item.disabled);

  const focusItem = (index: number): void => {
    const items = enabledItems();
    if (items.length === 0) {
      return;
    }
    const wrapped = (index + items.length) % items.length;
    items[wrapped]?.focus();
  };

  const focusedIndex = (): number =>
    enabledItems().findIndex((item) => item === root.ownerDocument.activeElement);

  const onDocumentPointer = (event: Event): void => {
    if (event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    close();
  };

  function isOpen(): boolean {
    return !menu.hidden;
  }

  function open(focus: 'first' | 'last' = 'first'): void {
    if (!isOpen()) {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      root.ownerDocument.addEventListener('mousedown', onDocumentPointer, true);
      root.ownerDocument.addEventListener('focusin', onDocumentPointer, true);
    }
    focusItem(focus === 'first' ? 0 : -1);
  }

  function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
    if (!isOpen()) {
      return;
    }
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.ownerDocument.removeEventListener('mousedown', onDocumentPointer, true);
    root.ownerDocument.removeEventListener('focusin', onDocumentPointer, true);
    if (restoreFocus) {
      trigger.focus();
    }
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  });

  menu.addEventListener('keydown', (event) => {
    const count = enabledItems().length;
    switch (event.key) {
      case 'ArrowDown':
        focusItem(focusedIndex() + 1);
        break;
      case 'ArrowUp':
        focusItem(focusedIndex() < 0 ? count - 1 : focusedIndex() - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(count - 1);
        break;
      case 'Escape':
        close({ restoreFocus: true });
        break;
      case 'Tab':
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  return { root, trigger, menu, isOpen, open, close };
}
