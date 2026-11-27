import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { h } from '../../ui/dom.ts';
import { button, formField, select, textInput } from '../../ui/forms.ts';
import {
  ACTIVITY_TITLES,
  parseRecentReposConfig,
  RECENT_REPOS_LIMITS,
} from './recent-repos-config.ts';
import type { RecentReposActivity, RecentReposConfig } from './recent-repos-config.ts';

const ACTIVITY_OPTIONS: readonly { value: RecentReposActivity; label: string }[] = [
  { value: 'code', label: 'Code changes' },
  { value: 'all', label: 'All activity' },
];

const ACTIVITY_HINT =
  'Code changes are pushes, pull requests and created branches. ' +
  'All activity also includes reviews, issues, comments and releases.';

export function renderRecentReposForm(
  target: HTMLElement,
  context: ConfigFormContext<RecentReposConfig>,
): Dispose {
  const { config } = context;
  const titleInput = textInput({ name: 'title', value: config.title ?? '' });
  const updateTitlePlaceholder = (activity: string): void => {
    titleInput.placeholder = ACTIVITY_TITLES[parseRecentReposConfig({ activity }).activity];
  };
  updateTitlePlaceholder(config.activity);

  const activitySelect = select({
    name: 'activity',
    value: config.activity,
    options: ACTIVITY_OPTIONS,
    onChange: updateTitlePlaceholder,
  });
  const limitSelect = select({
    name: 'limit',
    value: String(config.limit),
    options: RECENT_REPOS_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) })),
  });

  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    context.submit(
      parseRecentReposConfig({
        title: titleInput.value,
        activity: activitySelect.value,
        limit: Number(limitSelect.value),
      }),
    );
  };

  const form = h(
    'form',
    { className: 'ghx-recent-repos-form', novalidate: true, on: { submit: onSubmit } },
    formField({
      label: 'Title',
      control: titleInput,
      hint: 'Leave empty to name the widget after the activity.',
    }),
    formField({ label: 'Activity', control: activitySelect, hint: ACTIVITY_HINT }),
    formField({ label: 'Number of repositories', control: limitSelect }),
    h(
      'div',
      { className: 'ghx-recent-repos-form__actions' },
      button({ label: 'Save', type: 'submit', variant: 'primary' }),
      button({ label: 'Cancel', onClick: () => context.cancel() }),
    ),
  );
  target.append(form);
  return () => form.remove();
}
