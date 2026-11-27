import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { eraseWidget } from '../../shared/widget.ts';
import { defaultRecentReposConfig } from './recent-repos-config.ts';
import { createRecentReposWidget, recentReposWidget } from './recent-repos-widget.ts';
import { createTestContext, flush, NOW, recentRepo } from './recent-repos.fixture.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('recentReposWidget', () => {
  it('describes a placeable, configurable widget', () => {
    const widget = recentReposWidget;

    assert.equal(widget.type, 'recent-repos');
    assert.equal(widget.title, 'Recent repositories');
    assert.ok(widget.description.length > 0);
    assert.equal(widget.singleton, false);
    assert.deepEqual(
      widget.presets.map((preset) => preset.id),
      ['recently-changed', 'all-activity'],
    );
    assert.deepEqual(widget.defaultConfig(), defaultRecentReposConfig());
    assert.deepEqual(widget.parseConfig(null), defaultRecentReposConfig());
    assert.equal(widget.instanceTitle(widget.defaultConfig()), 'Recently changed');
    assert.notEqual(widget.renderConfig, null);
  });

  it('works through the type-erased host interface', () => {
    const erased = eraseWidget(recentReposWidget);

    assert.equal(erased.instanceTitle({ activity: 'all', title: 7 }), 'All recent activity');
    const target = document.createElement('div');
    let submitted: unknown = null;
    const dispose = erased.renderConfig?.(target, {
      config: { activity: 'all', limit: 99 },
      data: createFakeWidgetData(),
      signal: new AbortController().signal,
      submit: (config) => {
        submitted = config;
      },
      cancel: () => {},
    });
    target.querySelector('form')?.requestSubmit();
    assert.deepEqual(submitted, { title: null, activity: 'all', limit: 10 });
    dispose?.();
  });

  it('mounts the list with the real clock by default', async () => {
    const data = createFakeWidgetData().handle('recentRepositories', async () =>
      dataResult([recentRepo({ lastActivityAt: new Date().toISOString() })]),
    );
    const test = createTestContext(data);
    const target = document.createElement('div');

    const dispose = recentReposWidget.mount(target, test.context, defaultRecentReposConfig());
    await flush();

    assert.equal(target.querySelector('.ghx-row time')?.textContent, 'just now');
    dispose();
    assert.equal(target.childElementCount, 0);
  });

  it('uses an injected clock', async () => {
    const data = createFakeWidgetData().handle('recentRepositories', async () =>
      dataResult([recentRepo({ lastActivityAt: '2026-11-25T12:00:00Z' })]),
    );
    const widget = createRecentReposWidget({ now: () => NOW });
    const target = document.createElement('div');

    widget.mount(target, createTestContext(data).context, defaultRecentReposConfig());
    await flush();

    assert.equal(target.querySelector('.ghx-row time')?.textContent, 'yesterday');
  });
});
