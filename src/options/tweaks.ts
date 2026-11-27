import type { KeyValueStore } from '../shared/storage.ts';
import { STORAGE_KEYS } from '../shared/storage.ts';
import { parseTweaks, TWEAK_AREAS, tweaksOfArea } from '../shared/tweaks.ts';
import type { TweakId, TweakSettings } from '../shared/tweaks.ts';
import { h } from '../ui/dom.ts';
import { checkbox, notice } from '../ui/forms.ts';

export interface TweaksDeps {
  /** `storage.sync`, so the tweaks follow the user to other browsers. */
  readonly store: KeyValueStore;
}

export interface TweaksSection {
  readonly element: HTMLDivElement;
  /** Settles once the stored settings are shown, also if loading failed. */
  readonly loaded: Promise<void>;
}

export function tweaksSection(deps: TweaksDeps): TweaksSection {
  const status = h('div', { className: 'ghx-tweaks__status', 'aria-live': 'polite' });
  const inputs = new Map<TweakId, HTMLInputElement>();
  let settings: TweakSettings = parseTweaks(undefined);
  // Writes run one after another so a slow save cannot overwrite a newer one.
  let saving: Promise<void> = Promise.resolve();

  const areas = TWEAK_AREAS.map((area) => {
    const boxes = tweaksOfArea(area.id).map((tweak) => {
      const box = checkbox({
        label: tweak.title,
        hint: tweak.description,
        checked: settings[tweak.id],
        disabled: true,
        onChange: (checked) => {
          saving = saving.then(() => save(tweak.id, checked));
        },
      });
      inputs.set(tweak.id, box.input);
      return box.root;
    });
    return h(
      'fieldset',
      { className: 'ghx-tweaks__area', dataset: { area: area.id } },
      h('legend', { className: 'ghx-tweaks__legend' }, area.title),
      h('p', { className: 'ghx-hint' }, area.description),
      boxes,
    );
  });

  function show(next: TweakSettings): void {
    settings = next;
    for (const [id, input] of inputs) {
      input.checked = settings[id];
    }
  }

  async function save(id: TweakId, checked: boolean): Promise<void> {
    const next = { ...settings, [id]: checked };
    status.replaceChildren();
    try {
      await deps.store.set(STORAGE_KEYS.tweaks, next);
      show(next);
      status.replaceChildren(notice({ variant: 'success', message: 'Saved.' }));
    } catch {
      show(settings);
      status.replaceChildren(
        notice({ variant: 'danger', message: 'The setting could not be saved. Try again.' }),
      );
    }
  }

  const loaded = deps.store
    .get(STORAGE_KEYS.tweaks)
    .then(
      (raw) => show(parseTweaks(raw)),
      () => {
        status.replaceChildren(
          notice({
            variant: 'warning',
            message: 'Saved settings could not be loaded, the defaults are shown.',
          }),
        );
      },
    )
    .then(() => {
      for (const input of inputs.values()) {
        input.disabled = false;
      }
    });

  const element = h(
    'div',
    { className: 'ghx-tweaks' },
    h('p', null, 'Small changes to GitHub pages, grouped by the area they affect.'),
    areas,
    status,
  );
  return { element, loaded };
}
