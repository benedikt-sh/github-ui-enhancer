import type { WidgetData } from './data.ts';
import type { RequestSender } from './messages.ts';

export function createWidgetDataClient(send: RequestSender): WidgetData {
  return {
    repoIndex: (options) => send('data.repoIndex', withOptions({}, options)),
    searchPullRequests: (query, options) =>
      send('data.searchPullRequests', withOptions({ query }, options)),
    searchIssues: (query, options) => send('data.searchIssues', withOptions({ query }, options)),
    subscribedIssues: (options) => send('data.subscribedIssues', withOptions({}, options)),
    workflowRuns: (repo, options) => send('data.workflowRuns', withOptions({ repo }, options)),
    branches: (repo, options) => send('data.branches', withOptions({ repo }, options)),
    recentRepositories: (options) =>
      send('data.recentRepositories', withOptions({}, options)),
  };
}

// exactOptionalPropertyTypes forbids `options: undefined`, so the key is only set when present.
function withOptions<P extends object, O>(params: P, options: O | undefined): P & { options?: O } {
  return options === undefined ? params : { ...params, options };
}
