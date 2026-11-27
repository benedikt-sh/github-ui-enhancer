import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../../test/dom.ts';
import type { DomEnvironment } from '../../../test/dom.ts';
import { createFakeWidgetData, dataResult } from '../../../test/fakes/widget-data.ts';
import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { DataResult } from '../../shared/data.ts';
import { ApiError } from '../../shared/errors.ts';
import type { WorkflowRunItem } from '../../shared/types.ts';
import type { Dispose, RefreshReason, WidgetContext } from '../../shared/widget.ts';
import { NOW, repoSummary, settle, workflowRun } from './actions-runs.fixture.ts';
import type { ActionsRunsConfig } from './config.ts';
import { defaultActionsRunsConfig } from './config.ts';
import { ACTIVE_POLL_INTERVAL, isActiveRun, mountRunsView } from './runs-view.ts';
import type { RunsViewEnvironment } from './runs-view.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const REPO = { owner: 'octo', name: 'repo' };
const CONFIG: ActionsRunsConfig = { ...defaultActionsRunsConfig(), repo: REPO };

interface Timer {
  readonly callback: () => void;
  readonly delay: number;
  active: boolean;
}

function createEnv() {
  const timers: Timer[] = [];
  const listeners = new Set<() => void>();
  let visible = true;
  const env: RunsViewEnvironment = {
    now: () => NOW,
    schedule(callback, delay) {
      const timer: Timer = { callback, delay, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    isVisible: () => visible,
    onVisibilityChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activePollInterval: ACTIVE_POLL_INTERVAL,
  };
  return {
    env,
    listeners,
    pending: () => timers.filter((timer) => timer.active),
    fire() {
      for (const timer of timers.filter((entry) => entry.active)) {
        timer.active = false;
        timer.callback();
      }
    },
    setVisible(value: boolean) {
      visible = value;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function createContext(data: FakeWidgetData) {
  const controller = new AbortController();
  const saved: ActionsRunsConfig[] = [];
  const refreshListeners = new Set<(reason: RefreshReason) => void>();
  let optionsOpened = 0;
  let saveError: Error | null = null;
  const context: WidgetContext<ActionsRunsConfig> = {
    instanceId: 'w1',
    data,
    signal: controller.signal,
    saveConfig: async (config) => {
      saved.push(config);
      if (saveError) {
        throw saveError;
      }
    },
    onRefresh(listener) {
      refreshListeners.add(listener);
      return () => refreshListeners.delete(listener);
    },
    openOptions: () => {
      optionsOpened += 1;
    },
  };
  return {
    context,
    controller,
    saved,
    refreshListeners,
    optionsOpened: () => optionsOpened,
    failSaves(error: Error) {
      saveError = error;
    },
    refresh(reason: RefreshReason) {
      for (const listener of refreshListeners) {
        listener(reason);
      }
    },
  };
}

function setup(config: ActionsRunsConfig = CONFIG) {
  const data = createFakeWidgetData();
  const ctx = createContext(data);
  const timers = createEnv();
  const target = document.createElement('div');
  document.body.append(target);
  const dispose = mountRunsView(target, ctx.context, config, timers.env);
  return { data, ctx, timers, target, dispose };
}

function runsResult(
  runs: WorkflowRunItem[],
  overrides: Partial<DataResult<WorkflowRunItem[]>> = {},
): Promise<DataResult<WorkflowRunItem[]>> {
  return Promise.resolve(dataResult(runs, overrides));
}

function rowIds(target: HTMLElement): string[] {
  const rows = [...target.querySelectorAll<HTMLElement>('.ghx-row')];
  return rows.map((row) => row.dataset['id'] ?? '');
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  assert.ok(found, `button "${text}" not found`);
  return found;
}

function statusFilter(target: HTMLElement): HTMLSelectElement {
  const element = target.querySelector<HTMLSelectElement>('.ghx-actions-runs__status-filter');
  assert.ok(element);
  return element;
}

function chooseStatus(target: HTMLElement, value: string): void {
  const element = statusFilter(target);
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

function allRunsLink(target: HTMLElement): string | null {
  return target.querySelector('.ghx-actions-runs__all')?.getAttribute('href') ?? null;
}

describe('isActiveRun', () => {
  it('counts queued and running runs, not waiting or completed ones', () => {
    assert.equal(isActiveRun({ status: 'queued' }), true);
    assert.equal(isActiveRun({ status: 'in_progress' }), true);
    assert.equal(isActiveRun({ status: 'pending' }), true);
    assert.equal(isActiveRun({ status: 'requested' }), true);
    assert.equal(isActiveRun({ status: 'waiting' }), false);
    assert.equal(isActiveRun({ status: 'completed' }), false);
  });
});

describe('mountRunsView', () => {
  it('lets the user pick a repo first, then saves it and loads the runs', async () => {
    const data = createFakeWidgetData();
    data.handle('repoIndex', async () => dataResult([repoSummary('octo/repo')]));
    data.handle('workflowRuns', () => runsResult([workflowRun(1)]));
    const ctx = createContext(data);
    const target = document.createElement('div');
    mountRunsView(target, ctx.context, defaultActionsRunsConfig(), createEnv().env);
    assert.ok(target.textContent?.includes('Choose a repository'));
    ctx.refresh('manual');
    assert.equal(data.callsTo('workflowRuns').length, 0);
    await settle();
    buttonByText(target, 'octo/repo').click();
    assert.deepEqual(ctx.saved, [{ ...defaultActionsRunsConfig(), repo: REPO }]);
    await settle();
    assert.deepEqual(rowIds(target), ['1']);
    assert.equal(target.querySelector('.ghx-actions-runs__header a')?.textContent, 'octo/repo');
  });

  it('opens the settings from the picker', async () => {
    const data = createFakeWidgetData();
    const ctx = createContext(data);
    const target = document.createElement('div');
    mountRunsView(target, ctx.context, defaultActionsRunsConfig(), createEnv().env);
    await settle();
    buttonByText(target, 'Open settings').click();
    assert.equal(ctx.optionsOpened(), 1);
  });

  it('shows a loading state, then the runs up to the limit', async () => {
    const data = createFakeWidgetData();
    const runs = Array.from({ length: 7 }, (_, index) => workflowRun(index + 1));
    data.handle('workflowRuns', () => runsResult(runs));
    const ctx = createContext(data);
    const target = document.createElement('div');
    mountRunsView(target, ctx.context, { ...CONFIG, limit: 5 }, createEnv().env);
    assert.ok(target.querySelector('.ghx-state--loading'));
    await settle();
    assert.deepEqual(rowIds(target), ['1', '2', '3', '4', '5']);
    assert.deepEqual(data.callsTo('workflowRuns'), [[REPO, { limit: 5, forceRefresh: false }]]);
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions');
    assert.equal(target.querySelector('.ghx-actions-runs__stale'), null);
  });

  it('filters by the configured branch', async () => {
    const { data, target } = setup({ ...CONFIG, branch: 'dev' });
    await settle();
    assert.deepEqual(data.callsTo('workflowRuns'), [
      [REPO, { limit: 10, forceRefresh: false, branch: 'dev' }],
    ]);
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions?query=branch%3Adev');
    assert.ok(target.textContent?.includes('There are no workflow runs on dev.'));
    const select = target.querySelector('select');
    assert.equal(select?.value, 'dev');
  });

  it('keeps the status filter when picking a repo', async () => {
    const data = createFakeWidgetData();
    data.handle('repoIndex', async () => dataResult([repoSummary('octo/repo')]));
    const ctx = createContext(data);
    const target = document.createElement('div');
    const config: ActionsRunsConfig = { ...defaultActionsRunsConfig(), status: 'failure' };
    mountRunsView(target, ctx.context, config, createEnv().env);
    await settle();
    buttonByText(target, 'octo/repo').click();
    assert.deepEqual(ctx.saved, [{ ...config, repo: REPO }]);
    assert.equal(statusFilter(target).value, 'failure');
    assert.deepEqual(data.callsTo('workflowRuns'), [
      [REPO, { limit: 10, forceRefresh: false, status: 'failure' }],
    ]);
  });

  it('shows only failed runs if configured', async () => {
    const { data, target } = setup({ ...CONFIG, branch: 'dev', status: 'failure' });
    await settle();
    assert.deepEqual(data.callsTo('workflowRuns'), [
      [REPO, { limit: 10, forceRefresh: false, branch: 'dev', status: 'failure' }],
    ]);
    assert.equal(statusFilter(target).value, 'failure');
    assert.equal(
      allRunsLink(target),
      'https://github.com/octo/repo/actions?query=branch%3Adev%20is%3Afailure',
    );
    assert.ok(target.textContent?.includes('No failed runs'));
    assert.ok(target.textContent?.includes('There are no failed workflow runs on dev.'));
  });

  it('explains an empty failed runs list without a branch', async () => {
    const { target } = setup({ ...CONFIG, status: 'failure' });
    await settle();
    assert.ok(target.textContent?.includes('This repository has no failed workflow runs.'));
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions?query=is%3Afailure');
  });

  it('changes the status filter, saves it and reloads', async () => {
    const { data, ctx, target } = setup({ ...CONFIG, branch: 'dev' });
    await settle();
    assert.equal(statusFilter(target).value, 'all');
    assert.deepEqual(
      [...statusFilter(target).options].map((option) => option.textContent),
      ['All runs', 'Failed runs'],
    );
    data.handle('workflowRuns', () =>
      runsResult([workflowRun(4, { conclusion: 'failure', branch: 'dev' })]),
    );
    chooseStatus(target, 'failure');
    assert.deepEqual(ctx.saved, [{ ...CONFIG, branch: 'dev', status: 'failure' }]);
    assert.equal(
      allRunsLink(target),
      'https://github.com/octo/repo/actions?query=branch%3Adev%20is%3Afailure',
    );
    assert.ok(target.querySelector('.ghx-state--loading'));
    await settle();
    assert.deepEqual(rowIds(target), ['4']);
    assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
      REPO,
      { limit: 10, forceRefresh: false, branch: 'dev', status: 'failure' },
    ]);

    chooseStatus(target, 'all');
    assert.deepEqual(ctx.saved.at(-1), { ...CONFIG, branch: 'dev', status: 'all' });
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions?query=branch%3Adev');
    assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
      REPO,
      { limit: 10, forceRefresh: false, branch: 'dev' },
    ]);
  });

  it('keeps the status filter when the branch changes', async () => {
    const { data, ctx, target } = setup({ ...CONFIG, status: 'failure' });
    data.handle('branches', async () => dataResult([{ name: 'dev', protected: false }]));
    const branch = target.querySelector<HTMLSelectElement>('.ghx-actions-runs__branch');
    assert.ok(branch);
    branch.dispatchEvent(new Event('focus'));
    await settle();
    branch.value = 'dev';
    branch.dispatchEvent(new Event('change'));
    assert.deepEqual(ctx.saved, [{ ...CONFIG, branch: 'dev', status: 'failure' }]);
    assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
      REPO,
      { limit: 10, forceRefresh: false, branch: 'dev', status: 'failure' },
    ]);
  });

  it('falls back to all runs for unknown status values', async () => {
    const { ctx, target } = setup({ ...CONFIG, status: 'failure' });
    await settle();
    const odd = document.createElement('option');
    odd.value = 'success';
    statusFilter(target).append(odd);
    chooseStatus(target, 'success');
    assert.equal(ctx.saved.at(-1)?.status, 'all');
  });

  it('shows an empty state without runs', async () => {
    const { target } = setup();
    await settle();
    assert.ok(target.textContent?.includes('This repository has no workflow runs yet.'));
  });

  it('explains token errors and offers settings and retry', async () => {
    const { data, ctx, target } = setup();
    data.handle('workflowRuns', () =>
      runsResult([], { errors: [{ kind: 'no_token_for_owner', message: '', owner: 'octo' }] }),
    );
    ctx.refresh('interval');
    await settle();
    assert.ok(target.textContent?.includes('No access to the workflow runs'));
    assert.ok(target.textContent?.includes('No token is configured for octo.'));
    buttonByText(target, 'Open settings').click();
    assert.equal(ctx.optionsOpened(), 1);
    data.handle('workflowRuns', () => runsResult([workflowRun(3)]));
    buttonByText(target, 'Retry').click();
    assert.ok(target.querySelector('.ghx-state--loading'));
    await settle();
    assert.deepEqual(rowIds(target), ['3']);
    assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
      REPO,
      { limit: 10, forceRefresh: true },
    ]);
  });

  it('titles other errors generically', async () => {
    const data = createFakeWidgetData();
    data.handle('workflowRuns', () =>
      runsResult([], { errors: [{ kind: 'not_found', message: '' }] }),
    );
    const target = document.createElement('div');
    mountRunsView(target, createContext(data).context, CONFIG, createEnv().env);
    await settle();
    assert.ok(target.textContent?.includes('Could not load workflow runs'));
  });

  it('shows partial errors above the list', async () => {
    const data = createFakeWidgetData();
    data.handle('workflowRuns', () =>
      runsResult([workflowRun(1)], { errors: [{ kind: 'forbidden', message: '' }] }),
    );
    const ctx = createContext(data);
    const target = document.createElement('div');
    mountRunsView(target, ctx.context, CONFIG, createEnv().env);
    await settle();
    assert.ok(target.querySelector('.ghx-notice--warning'));
    assert.deepEqual(rowIds(target), ['1']);
    buttonByText(target, 'Open settings').click();
    assert.equal(ctx.optionsOpened(), 1);
  });

  it('shows rejected requests as error with retry', async () => {
    const data = createFakeWidgetData();
    data.handle('workflowRuns', async () => {
      throw new ApiError({ kind: 'network', message: 'down' });
    });
    const target = document.createElement('div');
    const timers = createEnv();
    mountRunsView(target, createContext(data).context, CONFIG, timers.env);
    await settle();
    assert.ok(target.textContent?.includes('GitHub could not be reached'));
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions');
    assert.equal(timers.pending().length, 0);
    buttonByText(target, 'Retry').click();
    assert.equal(data.callsTo('workflowRuns').length, 2);
  });

  it('marks stale data', async () => {
    const data = createFakeWidgetData();
    data.handle('workflowRuns', () =>
      runsResult([workflowRun(1)], { stale: true, fetchedAt: '2026-11-26T11:50:00Z' }),
    );
    const target = document.createElement('div');
    mountRunsView(target, createContext(data).context, CONFIG, createEnv().env);
    await settle();
    const stale = target.querySelector('.ghx-actions-runs__stale');
    assert.equal(stale?.textContent, 'Outdated, fetched 10 minutes ago');
    assert.ok(stale?.getAttribute('title')?.startsWith('Fetched '));
  });

  it('refreshes in place, bypassing the cache only for manual refreshes', async () => {
    const { data, ctx, target } = setup();
    data.handle('workflowRuns', () => runsResult([workflowRun(1)]));
    ctx.refresh('visible');
    await settle();
    data.handle('workflowRuns', () => runsResult([workflowRun(2)]));
    ctx.refresh('manual');
    assert.deepEqual(rowIds(target), ['1']);
    await settle();
    assert.deepEqual(rowIds(target), ['2']);
    assert.deepEqual(
      data.callsTo('workflowRuns').map((args) => args[1]),
      [
        { limit: 10, forceRefresh: false },
        { limit: 10, forceRefresh: false },
        { limit: 10, forceRefresh: true },
      ],
    );
  });

  it('ignores responses of superseded requests', async () => {
    const data = createFakeWidgetData();
    const pending: ((value: DataResult<WorkflowRunItem[]>) => void)[] = [];
    data.handle(
      'workflowRuns',
      () => new Promise<DataResult<WorkflowRunItem[]>>((resolve) => pending.push(resolve)),
    );
    const ctx = createContext(data);
    const target = document.createElement('div');
    mountRunsView(target, ctx.context, CONFIG, createEnv().env);
    ctx.refresh('manual');
    pending[1]?.(dataResult([workflowRun(2)]));
    pending[0]?.(dataResult([workflowRun(1)]));
    await settle();
    assert.deepEqual(rowIds(target), ['2']);
  });

  it('changes the branch, saves it and reloads', async () => {
    const { data, ctx, target } = setup();
    data.handle('branches', async () => dataResult([{ name: 'dev', protected: false }]));
    await settle();
    const select = target.querySelector('select');
    assert.ok(select);
    select.dispatchEvent(new Event('focus'));
    await settle();
    select.value = 'dev';
    select.dispatchEvent(new Event('change'));
    assert.deepEqual(ctx.saved, [{ ...CONFIG, branch: 'dev' }]);
    assert.equal(allRunsLink(target), 'https://github.com/octo/repo/actions?query=branch%3Adev');
    assert.ok(target.querySelector('.ghx-state--loading'));
    assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
      REPO,
      { limit: 10, forceRefresh: false, branch: 'dev' },
    ]);
  });

  it('warns when the config could not be saved', async () => {
    const { ctx, target, dispose } = setup();
    ctx.failSaves(new Error('quota'));
    const select = target.querySelector('select');
    assert.ok(select);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await settle();
    assert.ok(target.textContent?.includes('The change could not be saved.'));

    select.dispatchEvent(new Event('change'));
    assert.equal(target.querySelector('.ghx-actions-runs__status')?.textContent, '');
    dispose();
    await settle();
    assert.equal(target.querySelector('.ghx-actions-runs__status')?.textContent, '');
    const calls = ctx.saved.length;
    select.dispatchEvent(new Event('change'));
    assert.equal(ctx.saved.length, calls + 1);
  });

  describe('polling active runs', () => {
    it('polls while a run is active and stops when all are done', async () => {
      const { data, ctx, timers } = setup();
      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'in_progress', conclusion: null })]),
      );
      ctx.refresh('interval');
      await settle();
      assert.equal(timers.pending().length, 1);
      assert.equal(timers.pending()[0]?.delay, ACTIVE_POLL_INTERVAL);

      data.handle('workflowRuns', () => runsResult([workflowRun(1)]));
      timers.fire();
      await settle();
      assert.equal(data.callsTo('workflowRuns').length, 3);
      assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
        REPO,
        { limit: 10, forceRefresh: false },
      ]);
      assert.equal(timers.pending().length, 0);
    });

    it('pauses while hidden and resumes when visible', async () => {
      const { data, ctx, timers } = setup();
      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'queued', conclusion: null })]),
      );
      ctx.refresh('interval');
      await settle();
      assert.equal(timers.pending().length, 1);
      timers.setVisible(false);
      assert.equal(timers.pending().length, 0);
      timers.setVisible(true);
      assert.equal(timers.pending().length, 1);
    });

    it('skips a poll that fires while hidden', async () => {
      const { data, ctx, timers } = setup();
      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'queued', conclusion: null })]),
      );
      ctx.refresh('interval');
      await settle();
      const calls = data.callsTo('workflowRuns').length;
      const [timer] = timers.pending();
      assert.ok(timer);
      // Hidden without a visibility event, e.g. if the event was missed.
      timers.env.isVisible = () => false;
      timer.callback();
      assert.equal(data.callsTo('workflowRuns').length, calls);
    });

    it('does not poll a list of failed, completed runs', async () => {
      const { data, timers } = setup({ ...CONFIG, status: 'failure' });
      data.handle('workflowRuns', () => runsResult([workflowRun(1, { conclusion: 'failure' })]));
      await settle();
      assert.equal(timers.pending().length, 0);
    });

    it('cancels the poll on a filter change and polls active runs with the filter', async () => {
      const { data, ctx, target, timers } = setup();
      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'in_progress', conclusion: null })]),
      );
      ctx.refresh('interval');
      await settle();
      assert.equal(timers.pending().length, 1);

      chooseStatus(target, 'failure');
      assert.equal(timers.pending().length, 0);
      await settle();
      assert.equal(timers.pending().length, 1);
      timers.fire();
      assert.deepEqual(data.callsTo('workflowRuns').at(-1), [
        REPO,
        { limit: 10, forceRefresh: false, status: 'failure' },
      ]);
    });

    it('does not poll for waiting runs or while hidden', async () => {
      const { data, ctx, timers } = setup();
      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'waiting', conclusion: null })]),
      );
      ctx.refresh('interval');
      await settle();
      assert.equal(timers.pending().length, 0);

      data.handle('workflowRuns', () =>
        runsResult([workflowRun(1, { status: 'queued', conclusion: null })]),
      );
      timers.setVisible(false);
      ctx.refresh('interval');
      await settle();
      assert.equal(timers.pending().length, 0);
    });
  });

  describe('dispose', () => {
    it('stops timers, listeners and ignores late responses', async () => {
      const data = createFakeWidgetData();
      let resolve: (value: DataResult<WorkflowRunItem[]>) => void = () => {};
      data.handle('workflowRuns', () => runsResult([workflowRun(1, { status: 'queued' })]));
      const ctx = createContext(data);
      const timers = createEnv();
      const target = document.createElement('div');
      const dispose: Dispose = mountRunsView(target, ctx.context, CONFIG, timers.env);
      await settle();
      assert.equal(timers.pending().length, 1);
      data.handle(
        'workflowRuns',
        () => new Promise<DataResult<WorkflowRunItem[]>>((done) => (resolve = done)),
      );
      ctx.refresh('manual');
      dispose();
      dispose();
      resolve(dataResult([workflowRun(9)]));
      await settle();
      assert.deepEqual(rowIds(target), ['1']);
      assert.equal(timers.pending().length, 0);
      assert.equal(ctx.refreshListeners.size, 0);
      assert.equal(timers.listeners.size, 0);
    });

    it('disposes when the signal aborts and ignores late rejections', async () => {
      const data = createFakeWidgetData();
      let reject: (error: Error) => void = () => {};
      data.handle(
        'workflowRuns',
        () => new Promise<DataResult<WorkflowRunItem[]>>((_, fail) => (reject = fail)),
      );
      const ctx = createContext(data);
      const target = document.createElement('div');
      mountRunsView(target, ctx.context, CONFIG, createEnv().env);
      ctx.controller.abort();
      reject(new Error('late'));
      await settle();
      assert.ok(target.querySelector('.ghx-state--loading'));
      assert.equal(ctx.refreshListeners.size, 0);
    });
  });
});
