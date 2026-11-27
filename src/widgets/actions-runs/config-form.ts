import { repoFullName } from '../../shared/repo.ts';
import type { ConfigFormContext, Dispose } from '../../shared/widget.ts';
import { h, uniqueId } from '../../ui/dom.ts';
import { button, formField, select, textInput } from '../../ui/forms.ts';
import { icon } from '../../ui/octicons.ts';
import { ALL_BRANCHES_LABEL, branchSelect } from './branch-select.ts';
import type { ActionsRunsConfig } from './config.ts';
import {
  DEFAULT_RUN_LIMIT,
  generatedTitle,
  isRunLimit,
  isRunStatusFilter,
  RUN_LIMITS,
  RUN_STATUS_FILTER_LABELS,
  RUN_STATUS_FILTERS,
} from './config.ts';
import type { RunStatusFilter } from './config.ts';
import { isSameRepo, repoPicker } from './repo-picker.ts';

export interface ConfigFormEnvironment {
  /** Epoch milliseconds, for the recency ranking of the repo search. */
  now(): number;
}

function parseStatus(value: string): RunStatusFilter {
  return isRunStatusFilter(value) ? value : 'all';
}

export function renderActionsRunsConfig(
  target: HTMLElement,
  context: ConfigFormContext<ActionsRunsConfig>,
  env: ConfigFormEnvironment,
): Dispose {
  const initial = context.config;
  let repo = initial.repo;
  let branch = initial.branch;
  let status = initial.status;

  const inputId = uniqueId('ghx-actions-runs-repo');
  const errorId = `${inputId}-error`;
  const selection = h('p', { className: 'ghx-hint ghx-actions-runs-form__selection' });
  const repoError = h(
    'p',
    { className: 'ghx-field__error', id: errorId, hidden: true },
    icon('alert'),
    'Choose a repository.',
  );
  const branchSlot = h('div', { className: 'ghx-actions-runs-form__branch' });
  const titleInput = textInput({ name: 'title', value: initial.title ?? '' });
  const limitSelect = select({
    name: 'limit',
    options: RUN_LIMITS.map((limit) => ({ value: String(limit), label: `${limit} runs` })),
    value: String(initial.limit),
  });
  const statusSelect = select({
    name: 'status',
    options: RUN_STATUS_FILTERS.map((filter) => ({
      value: filter,
      label: RUN_STATUS_FILTER_LABELS[filter],
    })),
    value: initial.status,
    onChange: (value) => {
      status = parseStatus(value);
      updateSelection();
    },
  });

  const updateSelection = (): void => {
    selection.textContent =
      repo === null ? 'No repository selected.' : `Selected: ${repoFullName(repo)}`;
    titleInput.placeholder = generatedTitle({ repo, branch, status });
  };

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

  const renderBranchField = (): void => {
    const control =
      repo === null
        ? select({ options: [{ value: '', label: ALL_BRANCHES_LABEL }], disabled: true })
        : branchSelect({
            data: context.data,
            repo,
            value: branch,
            signal: context.signal,
            lazy: false,
            onChange: (value) => {
              branch = value;
              updateSelection();
            },
          }).element;
    branchSlot.replaceChildren(
      formField({
        label: 'Branch',
        control,
        ...(repo === null ? { hint: 'Choose a repository first.' } : {}),
      }),
    );
  };

  const picker = repoPicker({
    data: context.data,
    signal: context.signal,
    now: env.now,
    selected: repo,
    inputId,
    onOpenSettings: null,
    onSelect: (chosen) => {
      if (!isSameRepo(repo, chosen)) {
        repo = { owner: chosen.owner, name: chosen.name };
        branch = null;
        renderBranchField();
      }
      picker.setSelected(repo);
      setRepoError(false);
      updateSelection();
    },
  });

  const repoField = h(
    'div',
    { className: 'ghx-field' },
    h(
      'label',
      { className: 'ghx-field__label', for: inputId },
      'Repository',
      h('span', { className: 'ghx-field__required', 'aria-hidden': 'true' }, ' *'),
    ),
    selection,
    picker.root,
    repoError,
  );

  const form = h(
    'form',
    {
      className: 'ghx-actions-runs-form',
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          if (repo === null) {
            setRepoError(true);
            picker.input.focus();
            return;
          }
          const limit = Number(limitSelect.value);
          const title = titleInput.value.trim();
          context.submit({
            repo,
            branch,
            limit: isRunLimit(limit) ? limit : DEFAULT_RUN_LIMIT,
            status,
            title: title === '' ? null : title,
          });
        },
      },
    },
    repoField,
    branchSlot,
    formField({ label: 'Show', control: statusSelect }),
    formField({ label: 'Number of runs', control: limitSelect }),
    formField({ label: 'Title', control: titleInput, hint: 'Leave empty to use the default.' }),
    h(
      'div',
      { className: 'ghx-actions-runs-form__actions' },
      button({ label: 'Save', type: 'submit', variant: 'primary' }),
      button({ label: 'Cancel', onClick: () => context.cancel() }),
    ),
  );

  renderBranchField();
  updateSelection();
  target.replaceChildren(form);

  return () => {
    target.replaceChildren();
  };
}
