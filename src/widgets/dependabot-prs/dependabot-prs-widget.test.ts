import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import { eraseWidget } from '../../shared/widget.ts';
import {
  createDependabotPrsWidget,
  DEPENDABOT_PRS_TYPE,
  dependabotPrsWidget,
} from './dependabot-prs-widget.ts';
import { createTestContext, flush, NOW, pullRequest, repoSummary } from './dependabot-prs.fixture.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

describe('dependabotPrsWidget', () => {
  it('describes a repeatable widget without presets', () => {
    assert.equal(dependabotPrsWidget.type, DEPENDABOT_PRS_TYPE);
    assert.equal(dependabotPrsWidget.type, 'dependabot-prs');
    assert.equal(dependabotPrsWidget.title, 'Dependabot pull requests');
    assert.equal(dependabotPrsWidget.singleton, false);
    assert.deepEqual(dependabotPrsWidget.presets, []);
    assert.deepEqual(dependabotPrsWidget.defaultConfig().repos, []);
    assert.ok(dependabotPrsWidget.renderConfig);
  });

  it('parses configs and derives instance titles through the erased definition', () => {
    const erased = eraseWidget(dependabotPrsWidget);
    assert.equal(erased.instanceTitle(null), 'Dependabot pull requests');
    assert.equal(erased.instanceTitle({ repos: ['octo/api'] }), 'Dependabot: octo/api');
    assert.equal(
      erased.instanceTitle({ repos: ['octo/api', 'octo/web', 'acme/x'] }),
      'Dependabot: 3 repositories',
    );
    assert.equal(erased.instanceTitle({ repos: ['octo/api'], title: 'Mine' }), 'Mine');
  });

  it('mounts with the injected clock', async () => {
    const data = createFakeWidgetData();
    data.handle('searchPullRequests', async () => dataResult([pullRequest()]));
    const widget = createDependabotPrsWidget({ now: () => NOW });
    const target = document.createElement('div');
    const test = createTestContext(data);
    const dispose = widget.mount(
      target,
      test.context,
      widget.parseConfig({ repos: ['octo/api'] }),
    );
    await flush();

    assert.equal(target.querySelector('.ghx-row time')?.textContent, '1 hour ago');
    dispose();
    assert.equal(target.childElementCount, 0);
  });

  it('renders the config form', async () => {
    const data = createFakeWidgetData();
    data.handle('repoIndex', async () => dataResult([repoSummary('octo/api')]));
    const widget = createDependabotPrsWidget({ now: () => NOW });
    const target = document.createElement('div');
    const renderConfig = widget.renderConfig;
    assert.ok(renderConfig);
    const dispose = renderConfig(target, {
      config: widget.defaultConfig(),
      data,
      signal: new AbortController().signal,
      submit: () => {},
      cancel: () => {},
    });
    await flush();

    const input = target.querySelector<HTMLInputElement>('.ghx-dependabot-picker input');
    assert.ok(input);
    input.value = 'api';
    input.dispatchEvent(new Event('input'));
    assert.equal(target.querySelectorAll('.ghx-dependabot-picker__option').length, 1);
    dispose();
    assert.equal(target.querySelector('form'), null);
  });

  it('uses the real clock by default', async () => {
    const widget = createDependabotPrsWidget();
    const data = createFakeWidgetData();
    data.handle('searchPullRequests', async () => dataResult([pullRequest()]));
    const target = document.createElement('div');
    const dispose = widget.mount(
      target,
      createTestContext(data).context,
      widget.parseConfig({ repos: ['octo/api'] }),
    );
    await flush();
    assert.ok(target.querySelector('.ghx-row time'));
    dispose();
  });
});
