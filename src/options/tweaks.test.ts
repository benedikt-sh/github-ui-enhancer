import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { installDom } from '../../test/dom.ts';
import type { DomEnvironment } from '../../test/dom.ts';
import { createFakeStorageArea } from '../../test/fakes/storage.ts';
import type { FakeStorageArea } from '../../test/fakes/storage.ts';
import { createAreaStore } from '../shared/storage.ts';
import type { KeyValueStore } from '../shared/storage.ts';
import { settle } from './fake-sender.fixture.ts';
import { tweaksSection } from './tweaks.ts';

let dom: DomEnvironment;

before(() => {
  dom = installDom('chrome-extension://fake-extension-id/options.html');
});

after(async () => {
  await dom.cleanup();
});

function box(element: HTMLElement, label: string): HTMLInputElement {
  const match = [...element.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  const input = match?.querySelector('input') ?? element.querySelector(`#${match?.htmlFor}`);
  assert.ok(input instanceof HTMLInputElement, label);
  return input;
}

function toggle(input: HTMLInputElement): void {
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change'));
}

function setup(initial: Record<string, unknown> = {}): {
  area: FakeStorageArea;
  store: KeyValueStore;
} {
  const area = createFakeStorageArea(initial);
  return { area, store: createAreaStore(area) };
}

describe('tweaksSection', () => {
  it('groups tweaks by area and shows the stored values once loaded', async () => {
    const { store } = setup({ 'ghx:tweaks': { 'dashboard.hideChangelog': true } });
    const section = tweaksSection({ store });
    const enhanced = box(section.element, 'Enhanced dashboard');

    assert.equal(enhanced.disabled, true);
    await section.loaded;

    const legends = [...section.element.querySelectorAll('legend')].map((l) => l.textContent);
    assert.deepEqual(legends, ['Dashboard']);
    assert.equal(enhanced.disabled, false);
    assert.equal(enhanced.checked, true);
    assert.equal(box(section.element, "Hide GitHub's changelog").checked, true);
  });

  it('saves the complete settings on every change', async () => {
    const { area, store } = setup();
    const section = tweaksSection({ store });
    await section.loaded;

    toggle(box(section.element, 'Enhanced dashboard'));
    toggle(box(section.element, "Hide GitHub's changelog"));
    await settle();

    assert.deepEqual(area.snapshot()['ghx:tweaks'], {
      'dashboard.enhanced': false,
      'dashboard.hideChangelog': true,
    });
    assert.equal(section.element.querySelector('.ghx-tweaks__status')?.textContent, 'Saved.');
  });

  it('reverts the checkbox and reports when saving fails', async () => {
    const { area, store } = setup();
    const section = tweaksSection({ store });
    await section.loaded;
    area.failWith(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));

    const changelog = box(section.element, "Hide GitHub's changelog");
    toggle(changelog);
    await settle();

    assert.equal(changelog.checked, false);
    assert.match(
      section.element.querySelector('.ghx-tweaks__status')?.textContent ?? '',
      /could not be saved/,
    );
  });

  it('falls back to the defaults when loading fails', async () => {
    const { area, store } = setup();
    area.failWith(new Error('unavailable'));
    const section = tweaksSection({ store });
    await section.loaded;

    assert.equal(box(section.element, 'Enhanced dashboard').checked, true);
    assert.equal(box(section.element, 'Enhanced dashboard').disabled, false);
    assert.match(
      section.element.querySelector('.ghx-tweaks__status')?.textContent ?? '',
      /defaults are shown/,
    );
  });
});
