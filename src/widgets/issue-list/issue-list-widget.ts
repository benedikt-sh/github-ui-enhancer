import type { WidgetDefinition } from '../../shared/widget.ts';
import {
  ISSUE_LIST_PRESETS,
  defaultIssueListConfig,
  issueListTitle,
  parseIssueListConfig,
} from './config.ts';
import type { IssueListConfig } from './config.ts';
import { renderIssueListForm } from './issue-list-form.ts';
import { mountIssueList } from './issue-list-view.ts';
import type { IssueListDeps } from './issue-list-view.ts';

export const ISSUE_LIST_TYPE = 'issue-list';

export function createIssueListWidget(deps: IssueListDeps): WidgetDefinition<IssueListConfig> {
  return {
    type: ISSUE_LIST_TYPE,
    title: 'Issues',
    description: 'Issues from a search query or the issues you are watching.',
    singleton: false,
    presets: ISSUE_LIST_PRESETS,
    defaultConfig: defaultIssueListConfig,
    parseConfig: parseIssueListConfig,
    instanceTitle: issueListTitle,
    mount: (target, context, config) => mountIssueList(target, context, config, deps),
    renderConfig: renderIssueListForm,
  };
}

export const issueListWidget = createIssueListWidget({ now: () => Date.now() });
