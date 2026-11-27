import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import type { Child } from '../../ui/dom.ts';
import { button, checkbox, formField, select, textInput } from '../../ui/forms.ts';
import {
  normalizeQuery,
  parsePullRequestListConfig,
  PR_LIST_LIMITS,
  PR_LIST_PRESETS,
  pullRequestListTitle,
} from './pr-list-config.ts';
import type { PullRequestListConfig } from './pr-list-config.ts';

function queryHint(): Child {
  return [
    h('code', null, 'is:pr'),
    ' is added automatically. Examples: ',
    h('code', null, 'is:open org:acme'),
    ', ',
    h('code', null, 'is:open label:bug repo:acme/api'),
    '.',
  ];
}

export function renderPullRequestListForm(
  target: HTMLElement,
  context: ConfigFormContext<PullRequestListConfig>,
): Dispose {
  const { config } = context;
  const titleInput = textInput({ name: 'title', value: config.title ?? '' });
  const updateTitlePlaceholder = (query: string): void => {
    titleInput.placeholder = pullRequestListTitle({ ...config, title: null, query });
  };
  updateTitlePlaceholder(config.query);

  const queryInput = textInput({
    name: 'query',
    value: config.query,
    placeholder: 'is:open author:@me',
    onInput: updateTitlePlaceholder,
  });
  const queryField = (error: string | null): HTMLDivElement =>
    formField({
      label: 'Search query',
      control: queryInput,
      hint: queryHint(),
      error,
      required: true,
    });
  let currentQueryField = queryField(null);

  const presets = h(
    'div',
    { className: 'ghx-pr-list-form__presets', role: 'group', 'aria-label': 'Query presets' },
    PR_LIST_PRESETS.map((preset) =>
      button({
        label: preset.title,
        size: 'small',
        onClick: () => {
          queryInput.value = preset.config.query;
          updateTitlePlaceholder(preset.config.query);
          queryInput.focus();
        },
      }),
    ),
  );

  const limitSelect = select({
    name: 'limit',
    value: String(config.limit),
    options: PR_LIST_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) })),
  });
  const showRepo = checkbox({
    name: 'showRepo',
    label: 'Show repository',
    checked: config.showRepo,
    hint: 'Turn off when the query covers a single repository.',
  });

  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (normalizeQuery(queryInput.value) === '') {
      const invalid = queryField('Enter a search query.');
      currentQueryField.replaceWith(invalid);
      currentQueryField = invalid;
      queryInput.focus();
      return;
    }
    context.submit(
      parsePullRequestListConfig({
        title: titleInput.value,
        query: queryInput.value,
        limit: Number(limitSelect.value),
        showRepo: showRepo.input.checked,
      }),
    );
  };

  const form = h(
    'form',
    { className: 'ghx-pr-list-form', novalidate: true, on: { submit: onSubmit } },
    formField({
      label: 'Title',
      control: titleInput,
      hint: 'Leave empty to name the widget after the preset or query.',
    }),
    currentQueryField,
    presets,
    formField({ label: 'Number of pull requests', control: limitSelect }),
    showRepo.root,
    h(
      'div',
      { className: 'ghx-pr-list-form__actions' },
      button({ label: 'Save', type: 'submit', variant: 'primary' }),
      button({ label: 'Cancel', onClick: () => context.cancel() }),
    ),
  );
  target.append(form);
  return () => form.remove();
}
