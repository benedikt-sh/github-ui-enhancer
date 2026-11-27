import type { RepoRef } from '../../shared/types.ts';
import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { h, uniqueId } from '../../ui/dom.ts';
import { button, checkbox, formField, select, textInput } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import {
  DEPENDABOT_LIMITS,
  generatedTitle,
  MAX_REPOS,
  parseDependabotPrsConfig,
} from './dependabot-prs-config.ts';
import type { DependabotPrsConfig } from './dependabot-prs-config.ts';
import { repoMultiPicker } from './repo-multi-picker.ts';

export interface DependabotPrsFormEnvironment {
  /** Epoch milliseconds, for the recency ranking of the repo search. */
  now(): number;
}

export function renderDependabotPrsForm(
  target: HTMLElement,
  context: ConfigFormContext<DependabotPrsConfig>,
  env: DependabotPrsFormEnvironment,
): Dispose {
  const { config } = context;
  let repos: readonly RepoRef[] = config.repos;

  const titleInput = textInput({
    name: 'title',
    value: config.title ?? '',
    placeholder: generatedTitle(repos),
  });

  const inputId = uniqueId('ghx-dependabot-prs-repos');
  const errorId = `${inputId}-error`;
  const repoError = h(
    'p',
    { className: 'ghx-field__error', id: errorId, hidden: true },
    icon('alert'),
    'Choose at least one repository.',
  );

  const setRepoError = (visible: boolean): void => {
    repoError.hidden = !visible;
    repoField.classList.toggle('ghx-field--invalid', visible);
    if (visible) {
      picker.input.setAttribute('aria-invalid', 'true');
      picker.input.setAttribute('aria-describedby', errorId);
    } else {
      picker.input.removeAttribute('aria-invalid');
      picker.input.removeAttribute('aria-describedby');
    }
  };

  const picker = repoMultiPicker({
    data: context.data,
    signal: context.signal,
    now: env.now,
    selected: repos,
    inputId,
    onOpenSettings: null,
    onChange: (next) => {
      repos = next;
      titleInput.placeholder = generatedTitle(repos);
      if (repos.length > 0) {
        setRepoError(false);
      }
    },
  });

  const repoField = h(
    'div',
    { className: 'ghx-field' },
    h(
      'label',
      { className: 'ghx-field__label', for: inputId },
      'Repositories',
      h('span', { className: 'ghx-field__required', 'aria-hidden': 'true' }, ' *'),
    ),
    picker.root,
    h('p', { className: 'ghx-hint' }, `Up to ${MAX_REPOS} repositories.`),
    repoError,
  );

  const limitSelect = select({
    name: 'limit',
    value: String(config.limit),
    options: DEPENDABOT_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) })),
  });
  const groupByRepo = checkbox({
    name: 'groupByRepo',
    label: 'Group by repository',
    checked: config.groupByRepo,
  });

  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (repos.length === 0) {
      setRepoError(true);
      picker.input.focus();
      return;
    }
    context.submit(
      parseDependabotPrsConfig({
        repos,
        title: titleInput.value,
        limit: Number(limitSelect.value),
        groupByRepo: groupByRepo.input.checked,
      }),
    );
  };

  const form = h(
    'form',
    { className: 'ghx-dependabot-prs-form', novalidate: true, on: { submit: onSubmit } },
    formField({
      label: 'Title',
      control: titleInput,
      hint: 'Leave empty to name the widget after the repositories.',
    }),
    repoField,
    formField({ label: 'Number of pull requests', control: limitSelect }),
    groupByRepo.root,
    h(
      'div',
      { className: 'ghx-dependabot-prs-form__actions' },
      button({ label: 'Save', type: 'submit', variant: 'primary' }),
      button({ label: 'Cancel', onClick: () => context.cancel() }),
    ),
  );
  target.append(form);
  return () => form.remove();
}
