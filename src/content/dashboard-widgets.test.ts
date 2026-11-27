import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLayout } from '../shared/layout.ts';
import type { ErasedWidgetDefinition } from '../shared/widget.ts';
import { createDefaultLayout, DASHBOARD_WIDGETS } from './dashboard-widgets.ts';

function sequentialIds(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

describe('DASHBOARD_WIDGETS', () => {
  it('registers every widget type once, all of them optional', () => {
    const types = DASHBOARD_WIDGETS.map((definition) => definition.type);

    assert.deepEqual(types, [
      'repo-search',
      'pr-list',
      'issue-list',
      'actions-runs',
      'recent-repos',
      'dependabot-prs',
    ]);
    assert.equal(DASHBOARD_WIDGETS.some((definition) => definition.singleton), false);
  });
});

describe('createDefaultLayout', () => {
  it('builds the default dashboard from widget presets', () => {
    const layout = createDefaultLayout(DASHBOARD_WIDGETS, sequentialIds());

    assert.deepEqual(
      layout.instances.map(({ id, type, width }) => ({ id, type, width })),
      [
        { id: 'id-1', type: 'pr-list', width: 'half' },
        { id: 'id-2', type: 'pr-list', width: 'half' },
        { id: 'id-3', type: 'issue-list', width: 'half' },
        { id: 'id-4', type: 'pr-list', width: 'half' },
        { id: 'id-5', type: 'issue-list', width: 'half' },
        { id: 'id-6', type: 'recent-repos', width: 'half' },
      ],
    );
    const titles = layout.instances.map((instance) => {
      const definition = DASHBOARD_WIDGETS.find((d) => d.type === instance.type);
      return definition?.instanceTitle(instance.config);
    });
    assert.deepEqual(titles, [
      'Review requested',
      'Assigned to me',
      'Assigned to me',
      'Created by me',
      'Watched issues',
      'Recently changed',
    ]);
  });

  it('produces a layout that survives parsing', () => {
    const layout = createDefaultLayout();

    assert.deepEqual(parseLayout(JSON.parse(JSON.stringify(layout))), layout);
  });

  it('falls back to the default config for missing presets and skips unknown types', () => {
    const prList = DASHBOARD_WIDGETS.find((definition) => definition.type === 'pr-list');
    assert.ok(prList);
    const withoutPresets: ErasedWidgetDefinition = { ...prList, presets: [] };

    const layout = createDefaultLayout([withoutPresets], sequentialIds());

    assert.equal(layout.instances.length, 3);
    for (const instance of layout.instances) {
      assert.deepEqual(instance.config, prList.defaultConfig());
    }
  });
});
