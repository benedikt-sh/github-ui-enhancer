import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { h } from './dom.ts';
import { dropdownMenu } from './menu.ts';
import type { DropdownMenu, MenuItem } from './menu.ts';

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

function setup(items?: MenuItem[]): { menu: DropdownMenu; selected: string[] } {
  const selected: string[] = [];
  const menu = dropdownMenu({
    label: 'Widget actions',
    items: items ?? [
      { label: 'Configure', icon: 'gear', onSelect: () => selected.push('configure') },
      { label: 'Move up', disabled: true, onSelect: () => selected.push('up') },
      { label: 'Move down', onSelect: () => selected.push('down') },
      'separator',
      {
        label: 'Remove',
        icon: 'trash',
        variant: 'danger',
        onSelect: () => selected.push('remove'),
      },
    ],
  });
  document.body.append(menu.root, h('button', { type: 'button', id: 'outside' }, 'outside'));
  return { menu, selected };
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function activeText(): string | null | undefined {
  return document.activeElement?.textContent;
}

describe('dropdownMenu', () => {
  it('renders an icon trigger connected to a hidden menu', () => {
    const { menu } = setup();
    const { trigger } = menu;

    assert.equal(trigger.type, 'button');
    assert.equal(trigger.getAttribute('aria-label'), 'Widget actions');
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.getAttribute('aria-controls'), menu.menu.id);
    assert.ok(trigger.querySelector('.ghx-icon--kebab-horizontal'));
    assert.ok(trigger.classList.contains('ghx-btn--icon'));
    assert.equal(menu.menu.getAttribute('role'), 'menu');
    assert.equal(menu.menu.hidden, true);
    assert.ok(menu.menu.classList.contains('ghx-menu--end'));
    assert.equal(menu.menu.querySelectorAll('[role="menuitem"]').length, 4);
    assert.equal(menu.menu.querySelectorAll('[role="separator"]').length, 1);
    assert.ok(menu.menu.querySelector('.ghx-menu__item--danger .ghx-icon--trash'));
    assert.equal(menu.isOpen(), false);
  });

  it('renders a text trigger with custom icon, start alignment and class', () => {
    const menu = dropdownMenu({
      label: 'Add widget',
      text: 'Add',
      icon: 'plus',
      align: 'start',
      className: 'extra',
      items: [],
    });

    assert.equal(menu.trigger.hasAttribute('aria-label'), false);
    assert.equal(menu.trigger.textContent, 'Add');
    assert.ok(menu.trigger.querySelector('.ghx-icon--plus'));
    assert.ok(menu.trigger.classList.contains('ghx-btn--default'));
    assert.ok(menu.menu.classList.contains('ghx-menu--start'));
    assert.ok(menu.root.classList.contains('extra'));
    assert.ok(
      dropdownMenu({ label: 'x', text: 'More', items: [] }).trigger.querySelector(
        '.ghx-icon--chevron-down',
      ),
    );
  });

  it('toggles on click and focuses the first enabled item', () => {
    const { menu } = setup();

    menu.trigger.click();

    assert.equal(menu.isOpen(), true);
    assert.equal(menu.trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(activeText(), 'Configure');

    menu.trigger.click();

    assert.equal(menu.isOpen(), false);
    assert.equal(menu.trigger.getAttribute('aria-expanded'), 'false');
  });

  it('opens from the keyboard at the first or last item', () => {
    const { menu } = setup();

    const down = press(menu.trigger, 'ArrowDown');
    assert.equal(down.defaultPrevented, true);
    assert.equal(activeText(), 'Configure');

    press(menu.trigger, 'ArrowUp');
    assert.equal(activeText(), 'Remove');

    assert.equal(press(menu.trigger, 'Enter').defaultPrevented, false);
  });

  it('moves focus with arrows, Home and End and skips disabled items', () => {
    const { menu } = setup();
    menu.open();

    press(menu.menu, 'ArrowDown');
    assert.equal(activeText(), 'Move down');
    press(menu.menu, 'ArrowDown');
    assert.equal(activeText(), 'Remove');
    press(menu.menu, 'ArrowDown');
    assert.equal(activeText(), 'Configure');
    press(menu.menu, 'ArrowUp');
    assert.equal(activeText(), 'Remove');
    press(menu.menu, 'Home');
    assert.equal(activeText(), 'Configure');
    press(menu.menu, 'End');
    assert.equal(activeText(), 'Remove');
    assert.equal(press(menu.menu, 'a').defaultPrevented, false);
  });

  it('starts at the last item on ArrowUp when no item has focus', () => {
    const { menu } = setup();
    menu.open();
    menu.trigger.focus();

    press(menu.menu, 'ArrowUp');

    assert.equal(activeText(), 'Remove');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { menu } = setup();
    menu.open();

    const event = press(menu.menu, 'Escape');

    assert.equal(event.defaultPrevented, true);
    assert.equal(menu.isOpen(), false);
    assert.equal(document.activeElement, menu.trigger);
  });

  it('closes on Tab without keeping focus', () => {
    const { menu } = setup();
    menu.open();

    const event = press(menu.menu, 'Tab');

    assert.equal(event.defaultPrevented, false);
    assert.equal(menu.isOpen(), false);
  });

  it('selects an item, closes and restores focus', () => {
    const { menu, selected } = setup();
    menu.open();

    menu.menu.querySelector<HTMLButtonElement>('.ghx-menu__item--danger')?.click();

    assert.deepEqual(selected, ['remove']);
    assert.equal(menu.isOpen(), false);
    assert.equal(document.activeElement, menu.trigger);
  });

  it('closes on outside pointer and focus but not on inside ones', () => {
    const { menu } = setup();
    const outside = document.getElementById('outside');
    menu.open();

    menu.menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert.equal(menu.isOpen(), true);

    outside?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert.equal(menu.isOpen(), false);

    menu.open();
    outside?.focus();
    assert.equal(menu.isOpen(), false);

    document.dispatchEvent(new MouseEvent('mousedown'));
    assert.equal(menu.isOpen(), false);
  });

  it('ignores close when already closed and open when already open', () => {
    const { menu } = setup();

    menu.close({ restoreFocus: true });
    assert.notEqual(document.activeElement, menu.trigger);

    menu.open('last');
    menu.open();
    assert.equal(menu.isOpen(), true);
    assert.equal(activeText(), 'Configure');
  });

  it('copes with menus without enabled items', () => {
    const { menu } = setup([{ label: 'Nothing', disabled: true, onSelect: () => undefined }]);
    menu.open();

    press(menu.menu, 'ArrowDown');

    assert.equal(menu.isOpen(), true);
    assert.notEqual(activeText(), 'Nothing');
  });
});
