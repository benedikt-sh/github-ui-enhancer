import type { WidgetData } from '../../shared/data.ts';
import type { RepoRef } from '../../shared/types.ts';
import { h } from '../../ui/dom.ts';
import { select } from '../../ui/forms.ts';

export const ALL_BRANCHES_LABEL = 'All branches';

export interface BranchSelectOptions {
  readonly data: WidgetData;
  readonly repo: RepoRef;
  readonly value: string | null;
  readonly signal: AbortSignal;
  readonly ariaLabel?: string;
  readonly className?: string;
  /** Loads the branches on first hover or focus instead of right away. */
  readonly lazy: boolean;
  readonly onChange: (branch: string | null) => void;
}

export interface BranchSelect {
  readonly element: HTMLSelectElement;
  /** Loads the branch list once, later calls return the same promise. */
  load(): Promise<void>;
}

function branchOption(name: string): HTMLOptionElement {
  return h('option', { value: name }, name);
}

export function branchSelect(options: BranchSelectOptions): BranchSelect {
  const { data, repo, signal } = options;
  const initial = options.value === null ? [] : [{ value: options.value, label: options.value }];
  const element = select({
    options: [{ value: '', label: ALL_BRANCHES_LABEL }, ...initial],
    value: options.value ?? '',
    className: options.className,
    ...(options.ariaLabel === undefined ? {} : { ariaLabel: options.ariaLabel }),
    onChange: (value) => options.onChange(value === '' ? null : value),
  });

  let loading: Promise<void> | null = null;

  const showError = (): void => {
    element.title = 'Could not load the branches';
  };

  const apply = (names: readonly string[]): void => {
    const current = element.value;
    const all = current === '' || names.includes(current) ? names : [current, ...names];
    element.replaceChildren(
      h('option', { value: '' }, ALL_BRANCHES_LABEL),
      ...all.map(branchOption),
    );
    element.value = current;
  };

  const load = (): Promise<void> => {
    loading ??= data.branches(repo).then(
      (result) => {
        if (signal.aborted) {
          return;
        }
        if (result.errors.length > 0) {
          showError();
        }
        apply(result.data.map((branch) => branch.name));
      },
      () => {
        if (!signal.aborted) {
          showError();
        }
      },
    );
    return loading;
  };

  if (options.lazy) {
    const trigger = (): void => {
      void load();
    };
    element.addEventListener('pointerenter', trigger, { once: true });
    element.addEventListener('focus', trigger, { once: true });
  } else {
    void load();
  }

  return { element, load };
}
