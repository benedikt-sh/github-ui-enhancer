import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { eraseWidget } from '../../shared/widget.ts';
import { defaultPullRequestListConfig } from './pr-list-config.ts';
import { createPullRequestListWidget, pullRequestListWidget } from './pr-list-widget.ts';
import { createTestContext, flush, NOW, pullRequest } from './pr-list.fixture.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('pullRequestListWidget', () => {
  it('describes a placeable, configurable widget', () => {
    const widget = pullRequestListWidget;

    assert.equal(widget.type, 'pr-list');
    assert.equal(widget.title, 'Pull requests');
    assert.ok(widget.description.length > 0);
    assert.equal(widget.singleton, false);
    assert.deepEqual(
      widget.presets.map((preset) => preset.id),
      ['assigned', 'review-requested', 'created'],
    );
    assert.deepEqual(widget.defaultConfig(), defaultPullRequestListConfig());
    assert.deepEqual(widget.parseConfig(null), defaultPullRequestListConfig());
    assert.equal(widget.instanceTitle(widget.defaultConfig()), 'Review requested');
    assert.notEqual(widget.renderConfig, null);
  });

  it('works through the type-erased host interface', () => {
    const erased = eraseWidget(pullRequestListWidget);

    assert.equal(erased.instanceTitle({ query: 'is:open org:acme', title: 7 }), 'is:open org:acme');
    const target = document.createElement('div');
    let submitted: unknown = null;
    const dispose = erased.renderConfig?.(target, {
      config: { query: 'is:open org:acme' },
      data: createFakeWidgetData(),
      signal: new AbortController().signal,
      submit: (config) => {
        submitted = config;
      },
      cancel: () => {},
    });
    target.querySelector('form')?.requestSubmit();
    assert.deepEqual(submitted, {
      title: null,
      query: 'is:open org:acme',
      limit: 10,
      showRepo: true,
    });
    dispose?.();
  });

  it('mounts the list with the real clock by default', async () => {
    const data = createFakeWidgetData().handle('searchPullRequests', async () =>
      dataResult([pullRequest({ updatedAt: new Date().toISOString() })]),
    );
    const test = createTestContext(data);
    const target = document.createElement('div');

    const config = defaultPullRequestListConfig();
    const dispose = pullRequestListWidget.mount(target, test.context, config);
    await flush();

    assert.equal(target.querySelector('.ghx-row time')?.textContent, 'just now');
    dispose();
    assert.equal(target.childElementCount, 0);
  });

  it('uses an injected clock', async () => {
    const data = createFakeWidgetData().handle('searchPullRequests', async () =>
      dataResult([pullRequest({ updatedAt: '2026-11-25T12:00:00Z' })]),
    );
    const widget = createPullRequestListWidget({ now: () => NOW });
    const target = document.createElement('div');

    widget.mount(target, createTestContext(data).context, defaultPullRequestListConfig());
    await flush();

    assert.equal(target.querySelector('.ghx-row time')?.textContent, 'yesterday');
  });
});
