import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData } from '../../../test/fakes/widget-data.ts';
import { eraseWidget } from '../../shared/widget.ts';
import type { ConfigFormContext, WidgetContext } from '../../shared/widget.ts';
import { NOW, settle } from './actions-runs.fixture.ts';
import {
  actionsRunsWidget,
  browserEnvironment,
  createActionsRunsWidget,
} from './actions-runs-widget.ts';
import type { ActionsRunsConfig } from './config.ts';
import { ACTIVE_POLL_INTERVAL } from './runs-view.ts';
import type { RunsViewEnvironment } from './runs-view.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPO = { owner: 'octo', name: 'repo' };

function fakeEnvironment(): RunsViewEnvironment {
  return {
    now: () => NOW,
    schedule: () => () => {},
    isVisible: () => true,
    onVisibilityChange: () => () => {},
    activePollInterval: ACTIVE_POLL_INTERVAL,
  };
}

describe('actionsRunsWidget', () => {
  it('describes a placeable widget', () => {
    assert.equal(actionsRunsWidget.type, 'actions-runs');
    assert.equal(actionsRunsWidget.singleton, false);
    assert.deepEqual(actionsRunsWidget.presets, []);
    assert.ok(actionsRunsWidget.description.length > 0);
    assert.deepEqual(actionsRunsWidget.defaultConfig(), {
      repo: null,
      branch: null,
      limit: 10,
      title: null,
    });
  });

  it('parses stored configs and builds titles through the erased definition', () => {
    const erased = eraseWidget(actionsRunsWidget);
    assert.equal(
      erased.instanceTitle({ repo: 'octo/repo', branch: 'main' }),
      'Actions: octo/repo @ main',
    );
    assert.equal(erased.instanceTitle('garbage'), 'Actions runs');
    assert.deepEqual(erased.parseConfig({ repo: REPO, limit: 5 }), {
      repo: REPO,
      branch: null,
      limit: 5,
      title: null,
    });
  });

  it('mounts the runs view and renders the config form', async () => {
    const widget = createActionsRunsWidget(fakeEnvironment);
    const data = createFakeWidgetData();
    const controller = new AbortController();
    const context: WidgetContext<ActionsRunsConfig> = {
      instanceId: 'w1',
      data,
      signal: controller.signal,
      saveConfig: async () => {},
      onRefresh: () => () => {},
      openOptions: () => {},
    };
    const target = document.createElement('div');
    const dispose = widget.mount(target, context, { ...widget.defaultConfig(), repo: REPO });
    await settle();
    assert.equal(data.callsTo('workflowRuns').length, 1);
    assert.ok(target.textContent?.includes('No workflow runs'));
    dispose();

    const formContext: ConfigFormContext<ActionsRunsConfig> = {
      config: widget.defaultConfig(),
      data,
      signal: controller.signal,
      submit: () => {},
      cancel: () => {},
    };
    const formTarget = document.createElement('div');
    assert.ok(widget.renderConfig);
    const disposeForm = widget.renderConfig(formTarget, formContext);
    assert.ok(formTarget.querySelector('form'));
    disposeForm();
  });
});

describe('browserEnvironment', () => {
  it('reads the clock and the document visibility', () => {
    const env = browserEnvironment();
    const before = Date.now();
    const now = env.now();
    assert.ok(now >= before && now <= Date.now());
    assert.equal(env.activePollInterval, ACTIVE_POLL_INTERVAL);
    assert.equal(env.isVisible(), document.visibilityState === 'visible');
  });

  it('forwards visibility changes until unsubscribed', () => {
    const env = browserEnvironment(document);
    let calls = 0;
    const stop = env.onVisibilityChange(() => {
      calls += 1;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 1);
  });

  it('schedules and cancels callbacks', async () => {
    const env = browserEnvironment();
    const fired: string[] = [];
    env.schedule(() => fired.push('kept'), 1);
    const cancel = env.schedule(() => fired.push('cancelled'), 1);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(fired, ['kept']);
  });
});
