import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import { createFakeWidget } from './host.fixture.ts';
import type { FakeWidget, FakeWidgetOptions } from './host.fixture.ts';
import { createWidgetSlot } from './widget-slot.ts';
import type { WidgetSlot, WidgetSlotOptions } from './widget-slot.ts';

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

interface Setup {
  readonly slot: WidgetSlot;
  readonly widget: FakeWidget;
  readonly persisted: unknown[];
  readonly errors: unknown[];
  readonly opened: number[];
}

function setup(
  widgetOptions: FakeWidgetOptions = {},
  slotOptions: Partial<WidgetSlotOptions> = {},
): Setup {
  const widget = createFakeWidget(widgetOptions);
  const persisted: unknown[] = [];
  const errors: unknown[] = [];
  const opened: number[] = [];
  const slot = createWidgetSlot({
    definition: widget,
    instanceId: 'w1',
    config: { name: 'mine' },
    data: createFakeWidgetData(),
    openOptions: () => opened.push(1),
    persistConfig: async (config) => {
      persisted.push(config);
    },
    reportError: (error) => errors.push(error),
    ...slotOptions,
  });
  document.body.append(slot.frame.root);
  return { slot, widget, persisted, errors, opened };
}

const bodyText = (slot: WidgetSlot): string | null => slot.frame.body.textContent;
const titleText = (slot: WidgetSlot): string | null | undefined =>
  slot.frame.root.querySelector('.ghx-widget__title-text')?.textContent;

function clickButton(root: Element, label: string): void {
  const match = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  assert.ok(match, `button "${label}" not found`);
  match.click();
}

describe('createWidgetSlot', () => {
  it('mounts the widget with its context and title', () => {
    const { slot, widget, opened } = setup({}, { className: 'extra', actions: [] });
    assert.equal(slot.mode, 'widget');
    assert.equal(titleText(slot), 'Fake list: mine');
    assert.equal(bodyText(slot), 'content mine');
    assert.ok(slot.frame.root.classList.contains('extra'));
    assert.equal(slot.configurable, false);
    const record = widget.active();
    assert.equal(record?.context.instanceId, 'w1');
    assert.equal(record?.target, slot.frame.body);
    record?.context.openOptions();
    assert.equal(opened.length, 1);
  });

  it('forwards refreshes to registered listeners and isolates failures', () => {
    const { slot, widget, errors } = setup();
    const record = widget.active();
    const failure = new Error('listener');
    const unsubscribe = record?.context.onRefresh(() => {
      throw failure;
    });
    slot.refresh('interval');
    unsubscribe?.();
    slot.refresh('manual');
    assert.deepEqual(record?.refreshes, ['interval', 'manual']);
    assert.deepEqual(errors, [failure]);
  });

  it('saves the config without remounting and updates the title', async () => {
    const { slot, widget, persisted } = setup();
    await widget.active()?.context.saveConfig({ name: 'saved' });
    assert.deepEqual(persisted, [{ name: 'saved' }]);
    assert.deepEqual(slot.config, { name: 'saved' });
    assert.equal(titleText(slot), 'Fake list: saved');
    assert.equal(widget.mounts.length, 1);
  });

  it('ignores saves of a stale context', async () => {
    const { slot, widget, persisted } = setup({ configurable: true });
    const stale = widget.active();
    slot.configure();
    await stale?.context.saveConfig({ name: 'stale' });
    assert.deepEqual(persisted, []);
    assert.equal(stale?.context.signal.aborted, true);
  });

  it('falls back to the definition title when the instance title throws', () => {
    const widget = createFakeWidget();
    const failure = new Error('title');
    const errors: unknown[] = [];
    const slot = createWidgetSlot({
      definition: {
        ...widget,
        instanceTitle: () => {
          throw failure;
        },
      },
      instanceId: 'w1',
      config: null,
      data: createFakeWidgetData(),
      openOptions: () => undefined,
      persistConfig: async () => undefined,
      reportError: (error) => errors.push(error),
    });
    assert.equal(titleText(slot), 'Fake list');
    assert.deepEqual(errors, [failure]);
  });

  it('shows an error state when mount throws and retries', () => {
    let fail = true;
    const { slot, widget, errors } = setup({
      mountError: () => (fail ? new Error('boom') : null),
    });
    assert.equal(slot.mode, 'error');
    assert.equal(errors.length, 1);
    assert.match(bodyText(slot) ?? '', /could not be displayed/);
    slot.refresh('interval');
    assert.equal(slot.mode, 'error');
    fail = false;
    clickButton(slot.frame.body, 'Retry');
    assert.equal(slot.mode, 'widget');
    assert.equal(widget.mounts.length, 1);
  });

  it('remounts a failed widget on a manual refresh', () => {
    let fail = true;
    const { slot } = setup({ mountError: () => (fail ? new Error('boom') : null) });
    fail = false;
    slot.refresh('manual');
    assert.equal(slot.mode, 'widget');
    assert.equal(bodyText(slot), 'content mine');
  });

  it('reports errors thrown while disposing a widget', () => {
    const failure = new Error('dispose');
    const { slot, errors } = setup({ disposeError: failure });
    slot.dispose();
    assert.deepEqual(errors, [failure]);
  });

  it('opens the config form and remounts with the submitted config', () => {
    const { slot, widget, persisted } = setup({ configurable: true });
    assert.equal(slot.configurable, true);
    const first = widget.active();
    slot.configure();
    assert.equal(slot.mode, 'config');
    assert.equal(first?.disposed, true);
    slot.configure();
    assert.equal(widget.forms.length, 1);
    const form = widget.forms[0];
    assert.deepEqual(form?.context.config, { name: 'mine' });
    assert.ok(form?.target.classList.contains('ghx-host-config'));
    assert.equal(bodyText(slot), 'config form');
    form?.context.submit({ name: 'next' });
    assert.equal(form?.disposed, true);
    assert.equal(form?.context.signal.aborted, true);
    assert.deepEqual(persisted, [{ name: 'next' }]);
    assert.equal(slot.mode, 'widget');
    assert.deepEqual(widget.active()?.config, { name: 'next' });
    assert.equal(titleText(slot), 'Fake list: next');
    form?.context.submit({ name: 'again' });
    assert.equal(widget.mounts.length, 2);
  });

  it('remounts with the old config on cancel', () => {
    const { slot, widget, persisted } = setup({ configurable: true });
    slot.configure();
    slot.refresh('manual');
    widget.forms[0]?.context.cancel();
    assert.deepEqual(persisted, []);
    assert.deepEqual(widget.active()?.config, { name: 'mine' });
  });

  it('can start with the config form', () => {
    const { slot, widget } = setup({ configurable: true }, { startInConfig: true });
    assert.equal(slot.mode, 'config');
    assert.equal(widget.mounts.length, 0);
  });

  it('ignores the config form for widgets without one', () => {
    const { slot, widget } = setup({}, { startInConfig: true });
    slot.configure();
    assert.equal(slot.mode, 'widget');
    assert.equal(widget.forms.length, 0);
  });

  it('shows an error when the config form throws, with retry and back', () => {
    let fail = true;
    const { slot, widget, errors } = setup({
      configurable: true,
      formError: () => (fail ? new Error('form') : null),
    });
    slot.configure();
    assert.equal(slot.mode, 'error');
    assert.equal(errors.length, 1);
    assert.match(bodyText(slot) ?? '', /settings could not be displayed/);
    fail = false;
    clickButton(slot.frame.body, 'Retry');
    assert.equal(slot.mode, 'config');
    fail = true;
    widget.forms[0]?.context.cancel();
    slot.configure();
    clickButton(slot.frame.body, 'Back to widget');
    assert.equal(slot.mode, 'widget');
  });

  it('stops everything on dispose', () => {
    const { slot, widget } = setup({ configurable: true });
    const record = widget.active();
    slot.dispose();
    assert.equal(record?.disposed, true);
    assert.equal(record?.context.signal.aborted, true);
    slot.refresh('manual');
    slot.configure();
    assert.deepEqual(record?.refreshes, []);
    assert.equal(widget.forms.length, 0);
  });

  it('does not remount a failed widget after dispose', () => {
    const { slot, widget } = setup({ mountError: () => new Error('boom') });
    slot.dispose();
    slot.refresh('manual');
    assert.equal(widget.mounts.length, 0);
    assert.equal(slot.mode, 'error');
  });
});
