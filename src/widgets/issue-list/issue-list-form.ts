import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { button, checkbox, formField, select, textInput } from '../../ui/forms.ts';
import {
  ISSUE_LIMITS,
  ISSUE_LIST_PRESETS,
  automaticTitle,
  normalizeQuery,
  parseIssueListConfig,
} from './config.ts';
import type { IssueListConfig, IssueSource } from './config.ts';

const QUERY_HINT = 'GitHub search syntax, for example "is:open label:bug". '
  + '"is:issue" is added automatically.';
const QUERY_REQUIRED = 'Enter a search query.';

export function renderIssueListForm(
  target: HTMLElement,
  context: ConfigFormContext<IssueListConfig>,
): Dispose {
  const { config } = context;

  const sourceSelect = select({
    value: config.source,
    options: [
      { value: 'search', label: 'Search query' },
      { value: 'subscribed', label: 'Watched issues (subscribed)' },
    ],
    onChange: () => update(),
  });
  const titleInput = textInput({ value: config.title ?? '', onInput: () => update() });
  const queryInput = textInput({
    value: config.source === 'search' ? config.query : '',
    placeholder: 'is:open assignee:@me',
    onInput: () => {
      showQueryError(null);
      update();
    },
  });
  const limitSelect = select({
    value: String(config.limit),
    options: ISSUE_LIMITS.map((limit) => ({ value: String(limit), label: `${limit} issues` })),
  });
  const showRepo = checkbox({
    label: 'Show repository',
    checked: config.showRepo,
    hint: 'Turn off if all issues come from the same repository.',
  });

  const querySlot = h('div', { className: 'ghx-issue-list-form__query' });

  function showQueryError(error: string | null): void {
    queryInput.removeAttribute('aria-invalid');
    querySlot.replaceChildren(
      formField({ label: 'Query', control: queryInput, hint: QUERY_HINT, error }),
    );
  }

  function source(): IssueSource {
    return sourceSelect.value === 'subscribed' ? 'subscribed' : 'search';
  }

  function isQueryMissing(): boolean {
    return source() === 'search' && normalizeQuery(queryInput.value) === '';
  }

  function readConfig(): IssueListConfig {
    return parseIssueListConfig({
      source: source(),
      title: titleInput.value,
      query: source() === 'search' ? queryInput.value : '',
      limit: Number(limitSelect.value),
      showRepo: showRepo.input.checked,
    });
  }

  function update(): void {
    querySlot.hidden = source() !== 'search';
    titleInput.placeholder = isQueryMissing() ? '' : automaticTitle(readConfig());
  }

  function applyPreset(preset: IssueListConfig): void {
    sourceSelect.value = preset.source;
    if (preset.source === 'search') {
      queryInput.value = preset.query;
      showQueryError(null);
    }
    update();
  }

  const presets = h(
    'fieldset',
    { className: 'ghx-issue-list-form__presets' },
    h('legend', null, 'Quick picks'),
    ISSUE_LIST_PRESETS.map((preset) =>
      button({
        label: preset.title,
        size: 'small',
        onClick: () => applyPreset(preset.config),
      }),
    ),
  );

  const form = h(
    'form',
    {
      className: 'ghx-issue-list-form',
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          if (isQueryMissing()) {
            showQueryError(QUERY_REQUIRED);
            queryInput.focus();
            return;
          }
          context.submit(readConfig());
        },
      },
    },
    presets,
    formField({ label: 'Source', control: sourceSelect }),
    querySlot,
    formField({
      label: 'Title',
      control: titleInput,
      hint: 'Leave empty to use the preset name or the query.',
    }),
    formField({ label: 'Number of issues', control: limitSelect }),
    showRepo.root,
    h(
      'div',
      { className: 'ghx-issue-list-form__buttons' },
      button({ label: 'Cancel', onClick: () => context.cancel() }),
      button({ label: 'Save', variant: 'primary', type: 'submit' }),
    ),
  );

  showQueryError(null);
  update();
  target.append(form);
  return () => form.remove();
}
