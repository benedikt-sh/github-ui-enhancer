import type { RequestSender } from '../shared/messages.ts';
import type { KeyValueStore } from '../shared/storage.ts';
import { h } from '../ui/dom.ts';
import { addTokenForm } from './add-token-form.ts';
import { guidance } from './guidance.ts';
import { maintenance } from './maintenance.ts';
import { tokenList } from './token-list.ts';
import { tweaksSection } from './tweaks.ts';

export interface OptionsPageDeps {
  readonly send: RequestSender;
  /** `storage.sync`, holds the tweaks. */
  readonly settingsStore: KeyValueStore;
  readonly now?: () => Date;
}

export interface OptionsPage {
  /** Settles when the token list and the tweaks have loaded, successfully or not. */
  readonly loaded: Promise<void>;
  reload(): Promise<void>;
}

export function renderOptionsPage(root: HTMLElement, deps: OptionsPageDeps): OptionsPage {
  const { send } = deps;
  const now = deps.now ?? (() => new Date());
  const list = tokenList({ send, now });
  const form = addTokenForm({
    send,
    onAdded: (info) => list.upsert(info),
    onStale: () => void list.refresh(),
  });
  const tweaks = tweaksSection({ store: deps.settingsStore });

  root.classList.add('ghx-options');
  root.replaceChildren(
    h(
      'header',
      { className: 'ghx-options__header' },
      h('h1', { className: 'ghx-options__title' }, 'GitHub UI Enhancer'),
      h('p', { className: 'ghx-options__subtitle' }, 'Settings'),
    ),
    h(
      'section',
      { className: 'ghx-options__section', 'aria-labelledby': 'ghx-options-tokens' },
      h('h2', { className: 'ghx-options__heading', id: 'ghx-options-tokens' }, 'Access tokens'),
      guidance(),
      h('h3', { className: 'ghx-options__subheading' }, 'Your tokens'),
      list.element,
      h('h3', { className: 'ghx-options__subheading' }, 'Add a token'),
      form,
    ),
    h(
      'section',
      { className: 'ghx-options__section', 'aria-labelledby': 'ghx-options-tweaks' },
      h('h2', { className: 'ghx-options__heading', id: 'ghx-options-tweaks' }, 'Tweaks'),
      tweaks.element,
    ),
    h(
      'section',
      { className: 'ghx-options__section', 'aria-labelledby': 'ghx-options-maintenance' },
      h('h2', { className: 'ghx-options__heading', id: 'ghx-options-maintenance' }, 'Maintenance'),
      maintenance({ send }),
    ),
  );

  const loaded = Promise.all([list.load(), tweaks.loaded]).then(() => undefined);
  return { loaded, reload: () => list.load() };
}
