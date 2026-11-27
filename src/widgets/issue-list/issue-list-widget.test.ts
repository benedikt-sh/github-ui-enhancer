import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { eraseWidget } from '../../shared/widget.ts';
import type { WidgetContext } from '../../shared/widget.ts';
import { ISSUE_LIST_PRESETS } from './config.ts';
import { ISSUE_LIST_TYPE, createIssueListWidget, issueListWidget } from './issue-list-widget.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

function context<C>(): WidgetContext<C> {
  const data = createFakeWidgetData().handle('subscribedIssues', () =>
    Promise.resolve(
      dataResult([
        {
          id: 'I_1',
          number: 1,
          title: 'Watched',
          url: 'https://github.com/acme/app/issues/1',
          repo: { owner: 'acme', name: 'app' },
          author: null,
          state: 'open',
          stateReason: null,
          assignees: [],
          labels: [],
          commentCount: 0,
          createdAt: '2026-11-26T10:00:00.000Z',
          updatedAt: '2026-11-26T10:00:00.000Z',
        },
      ]),
    ),
  );
  return {
    instanceId: 'issues-1',
    data,
    signal: new AbortController().signal,
    saveConfig: () => Promise.resolve(),
    onRefresh: () => () => {},
    openOptions: () => {},
  };
}

describe('issueListWidget', () => {
  it('describes a repeatable widget with presets', () => {
    assert.equal(issueListWidget.type, ISSUE_LIST_TYPE);
    assert.equal(issueListWidget.type, 'issue-list');
    assert.equal(issueListWidget.singleton, false);
    assert.equal(issueListWidget.presets, ISSUE_LIST_PRESETS);
    assert.equal(issueListWidget.instanceTitle(issueListWidget.defaultConfig()), 'Assigned to me');
    assert.ok(issueListWidget.renderConfig);
  });

  it('parses stored configs through the erased definition', () => {
    const erased = eraseWidget(issueListWidget);

    assert.equal(erased.instanceTitle({ source: 'subscribed' }), 'Watched issues');
    assert.equal(erased.instanceTitle({ query: 'label:bug', title: '' }), 'label:bug');
    assert.deepEqual(erased.parseConfig(null), issueListWidget.defaultConfig());
  });

  it('mounts with the injected clock', async () => {
    const widget = createIssueListWidget({ now: () => Date.parse('2026-11-26T12:00:00.000Z') });
    const target = document.createElement('div');
    const dispose = eraseWidget(widget).mount(target, context(), { source: 'subscribed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(target.querySelector('.ghx-row__title')?.textContent, 'Watched');
    assert.equal(target.querySelector('time')?.textContent, '2 hours ago');
    dispose();
    assert.equal(target.childElementCount, 0);
  });

  it('mounts with the real clock by default', async () => {
    const target = document.createElement('div');
    const dispose = issueListWidget.mount(
      target,
      context(),
      issueListWidget.parseConfig({ source: 'subscribed' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(target.querySelector('time')?.textContent);
    dispose();
  });

  it('renders the config form', () => {
    const target = document.createElement('div');
    const renderConfig = eraseWidget(issueListWidget).renderConfig;
    assert.ok(renderConfig);
    const dispose = renderConfig(target, {
      config: { source: 'subscribed' },
      data: createFakeWidgetData(),
      signal: new AbortController().signal,
      submit: () => {},
      cancel: () => {},
    });

    assert.ok(target.querySelector('form.ghx-issue-list-form'));
    dispose();
  });
});
