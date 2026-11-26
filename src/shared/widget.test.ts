import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { createFakeWidgetData } from '../../test/fakes/widget-data.ts';
import { eraseWidget } from './widget.ts';
import type { ConfigFormContext, WidgetContext, WidgetDefinition } from './widget.ts';

interface CounterConfig {
  readonly step: number;
}

function parseConfig(raw: unknown): CounterConfig {
  const step = (raw as { step?: unknown } | undefined)?.step;
  return { step: typeof step === 'number' ? step : 1 };
}

function counterWidget(withForm: boolean): WidgetDefinition<CounterConfig> {
  return {
    type: 'counter',
    title: 'Counter',
    description: 'Counts',
    singleton: false,
    presets: [{ id: 'big', title: 'Big steps', config: { step: 10 } }],
    defaultConfig: () => ({ step: 1 }),
    parseConfig,
    instanceTitle: (config) => `Step ${config.step}`,
    mount(target, _context, config) {
      target.textContent = `step=${config.step}`;
      return () => {
        target.textContent = 'disposed';
      };
    },
    renderConfig: withForm
      ? (target, context) => {
          target.textContent = `form=${context.config.step}`;
          context.submit({ step: context.config.step + 1 });
          context.cancel();
          return () => {};
        }
      : null,
  };
}

describe('eraseWidget', () => {
  let dom: DomEnvironment;
  before(() => {
    dom = installDom();
  });
  after(() => dom.cleanup());

  const data = createFakeWidgetData();

  it('keeps metadata and delegates config handling', () => {
    const erased = eraseWidget(counterWidget(true));

    assert.equal(erased.type, 'counter');
    assert.equal(erased.title, 'Counter');
    assert.equal(erased.description, 'Counts');
    assert.equal(erased.singleton, false);
    assert.equal(erased.presets.length, 1);
    assert.deepEqual(erased.defaultConfig(), { step: 1 });
    assert.deepEqual(erased.parseConfig({ step: 'x' }), { step: 1 });
    assert.equal(erased.instanceTitle({ step: 3 }), 'Step 3');
    assert.equal(erased.instanceTitle('garbage'), 'Step 1');
  });

  it('parses raw config before mounting', () => {
    const erased = eraseWidget(counterWidget(true));
    const target = document.createElement('div');
    const context: WidgetContext<unknown> = {
      instanceId: 'i1',
      data,
      signal: new AbortController().signal,
      saveConfig: async () => {},
      onRefresh: () => () => {},
      openOptions: () => {},
    };

    const dispose = erased.mount(target, context, { step: 5 });
    assert.equal(target.textContent, 'step=5');
    dispose();
    assert.equal(target.textContent, 'disposed');
  });

  it('wraps the config form and forwards submit and cancel', () => {
    const erased = eraseWidget(counterWidget(true));
    const target = document.createElement('div');
    const submitted: unknown[] = [];
    let cancelled = false;
    const context: ConfigFormContext<unknown> = {
      config: { step: 2 },
      data,
      signal: new AbortController().signal,
      submit: (config) => submitted.push(config),
      cancel: () => {
        cancelled = true;
      },
    };

    assert.notEqual(erased.renderConfig, null);
    erased.renderConfig?.(target, context);

    assert.equal(target.textContent, 'form=2');
    assert.deepEqual(submitted, [{ step: 3 }]);
    assert.equal(cancelled, true);
  });

  it('keeps renderConfig null for widgets without settings', () => {
    assert.equal(eraseWidget(counterWidget(false)).renderConfig, null);
  });
});
