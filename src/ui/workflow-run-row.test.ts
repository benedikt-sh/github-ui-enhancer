import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import type { WorkflowRunConclusion, WorkflowRunItem } from '../shared/types.ts';
import { workflowRunDuration, workflowRunRow, workflowRunStatus } from './workflow-run-row.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom();
});

after(async () => {
  await dom.cleanup();
});

const NOW = '2026-11-26T12:00:00Z';

function run(overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id: 99,
    workflowName: 'CI',
    displayTitle: 'Merge pull request #5',
    runNumber: 321,
    runAttempt: 1,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    branch: 'main',
    headSha: 'abc',
    actor: {
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      url: 'https://github.com/octocat',
    },
    url: 'https://github.com/octo/repo/actions/runs/99',
    createdAt: '2026-11-26T11:00:00Z',
    updatedAt: '2026-11-26T11:03:12Z',
    runStartedAt: '2026-11-26T11:00:00Z',
    ...overrides,
  };
}

describe('workflowRunStatus', () => {
  it('maps every conclusion of completed runs', () => {
    const expected: Record<WorkflowRunConclusion, string> = {
      success: 'success',
      failure: 'danger',
      startup_failure: 'danger',
      timed_out: 'danger',
      cancelled: 'muted',
      skipped: 'muted',
      neutral: 'muted',
      stale: 'muted',
      action_required: 'attention',
    };
    for (const [conclusion, tone] of Object.entries(expected)) {
      const status = workflowRunStatus({
        status: 'completed',
        conclusion: conclusion as WorkflowRunConclusion,
      });
      assert.equal(status.tone, tone, conclusion);
    }
    assert.equal(workflowRunStatus({ status: 'completed', conclusion: null }).label, 'Completed');
  });

  it('maps every pending status regardless of conclusion', () => {
    assert.equal(workflowRunStatus({ status: 'in_progress', conclusion: null }).icon, 'dot-fill');
    for (const status of ['queued', 'waiting', 'requested', 'pending'] as const) {
      const result = workflowRunStatus({ status, conclusion: 'success' });
      assert.equal(result.icon, 'clock', status);
      assert.equal(result.tone, 'attention', status);
    }
  });
});

describe('workflowRunDuration', () => {
  it('measures completed runs from start to last update', () => {
    assert.equal(workflowRunDuration(run(), NOW), 192_000);
  });

  it('falls back to the creation time without a start time', () => {
    const value = workflowRunDuration(
      run({ runStartedAt: null, createdAt: '2026-11-26T11:02:12Z' }),
      NOW,
    );

    assert.equal(value, 60_000);
  });

  it('measures running runs until now', () => {
    const value = workflowRunDuration(run({ status: 'in_progress', conclusion: null }), NOW);

    assert.equal(value, 3_600_000);
  });

  it('returns null for queued runs and impossible or invalid times', () => {
    assert.equal(workflowRunDuration(run({ status: 'queued' }), NOW), null);
    assert.equal(workflowRunDuration(run({ updatedAt: '2026-11-26T10:00:00Z' }), NOW), null);
    assert.equal(workflowRunDuration(run({ updatedAt: 'garbage' }), NOW), null);
  });
});

describe('workflowRunRow', () => {
  it('renders a completed run', () => {
    const row = workflowRunRow(run(), { now: NOW });
    const meta = [...row.querySelectorAll('.ghx-row__meta-item')].map((item) => item.textContent);
    const duration = row.querySelector('.ghx-row__duration');

    assert.ok(row.classList.contains('ghx-row--workflow-run'));
    assert.equal(row.classList.contains('ghx-row--running'), false);
    assert.equal(row.dataset['id'], '99');
    assert.equal(row.querySelector('.ghx-row__repo'), null);
    assert.equal(row.querySelector('.ghx-row__icon svg')?.getAttribute('aria-label'), 'Success');
    assert.equal(row.querySelector('.ghx-row__title')?.textContent, 'Merge pull request #5');
    assert.deepEqual(meta, ['CI', '#321', 'pull request', 'main', 'by octocat']);
    assert.equal(duration?.getAttribute('aria-label'), 'Run duration: 3m 12s');
    assert.equal(duration?.textContent, '3m 12s');
    assert.equal(row.querySelector('.ghx-row__side time')?.textContent, '1 hour ago');
  });

  it('renders a running retried run without branch and actor', () => {
    const row = workflowRunRow(
      run({
        status: 'in_progress',
        conclusion: null,
        runAttempt: 2,
        branch: null,
        actor: null,
        event: 'push',
      }),
      { now: NOW },
    );
    const meta = [...row.querySelectorAll('.ghx-row__meta-item')].map((item) => item.textContent);

    assert.ok(row.classList.contains('ghx-row--running'));
    assert.equal(row.querySelector('.ghx-branch'), null);
    assert.deepEqual(meta, ['CI', '#321', 'attempt 2', 'push', 'by ghost']);
    assert.equal(
      row.querySelector('.ghx-row__duration')?.getAttribute('aria-label'),
      'Running for: 1h',
    );
  });

  it('omits the duration of queued runs', () => {
    const row = workflowRunRow(run({ status: 'queued', conclusion: null }), { now: NOW });

    assert.equal(row.querySelector('.ghx-row__duration'), null);
    assert.ok(row.querySelector('.ghx-row__side time'));
  });
});
