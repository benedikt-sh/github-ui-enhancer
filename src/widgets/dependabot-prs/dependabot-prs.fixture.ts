import type { FakeWidgetData } from '../../../test/fakes/widget-data.ts';
import type { PullRequestItem, RepoRef, RepoSummary } from '../../shared/types.ts';
import type { RefreshReason, WidgetContext } from '../../shared/widget.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';

export const NOW = new Date('2026-11-26T12:00:00Z');

export const DEPENDABOT = {
  login: 'dependabot',
  avatarUrl: 'https://avatars.githubusercontent.com/in/29110',
  url: 'https://github.com/apps/dependabot',
};

export function repo(fullName: string): RepoRef {
  const [owner = '', name = ''] = fullName.split('/');
  return { owner, name };
}

export function pullRequest(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  return {
    id: 'PR_1',
    number: 1,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    url: 'https://github.com/octo/api/pull/1',
    repo: { owner: 'octo', name: 'api' },
    author: DEPENDABOT,
    state: 'open',
    isDraft: false,
    reviewDecision: null,
    checkState: null,
    labels: [],
    commentCount: 0,
    createdAt: '2026-11-20T12:00:00Z',
    updatedAt: '2026-11-26T11:00:00Z',
    ...overrides,
  };
}

export function repoSummary(fullName: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  const { owner, name } = repo(fullName);
  return {
    id: `R_${fullName}`,
    owner,
    name,
    fullName,
    description: null,
    visibility: 'public',
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: '2026-11-20T00:00:00Z',
    url: `https://github.com/${fullName}`,
    ...overrides,
  };
}

export interface TestContext {
  readonly context: WidgetContext<DependabotPrsConfig>;
  readonly controller: AbortController;
  readonly saved: DependabotPrsConfig[];
  readonly openOptionsCalls: () => number;
  readonly listenerCount: () => number;
  refresh(reason: RefreshReason): void;
  /** Makes the following `saveConfig` calls reject. */
  failSaving(): void;
}

export function createTestContext(data: FakeWidgetData): TestContext {
  const controller = new AbortController();
  const listeners = new Set<(reason: RefreshReason) => void>();
  const saved: DependabotPrsConfig[] = [];
  let openOptions = 0;
  let saveFails = false;
  return {
    controller,
    saved,
    openOptionsCalls: () => openOptions,
    listenerCount: () => listeners.size,
    refresh(reason) {
      for (const listener of listeners) {
        listener(reason);
      }
    },
    failSaving() {
      saveFails = true;
    },
    context: {
      instanceId: 'dependabot-prs-1',
      data,
      signal: controller.signal,
      async saveConfig(config) {
        saved.push(config);
        if (saveFails) {
          throw new Error('storage full');
        }
      },
      onRefresh(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      openOptions() {
        openOptions += 1;
      },
    },
  };
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run, including chained ones. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (button) => button.textContent === text || button.getAttribute('aria-label') === text,
  );
  if (!found) {
    throw new Error(`button "${text}" not found`);
  }
  return found;
}

export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

export function pressKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}
