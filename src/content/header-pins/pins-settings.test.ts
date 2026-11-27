import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addPin,
  defaultPins,
  isPinned,
  MAX_PINS,
  parsePins,
  parseRepo,
  PINS_VERSION,
  removePin,
  repoKey,
  samePins,
  serializePins,
  setRecent,
} from './pins-settings.ts';

const repo = (owner: string, name: string) => ({ owner, name });

describe('parsePins', () => {
  it('falls back to the defaults for unknown input', () => {
    for (const raw of [undefined, null, 'x', [], {}, { version: 2, repos: [], recent: false }]) {
      assert.deepEqual(parsePins(raw), defaultPins());
    }
    assert.deepEqual(defaultPins(), { repos: [], recent: true });
  });

  it('keeps valid repos and the recent flag', () => {
    const raw = {
      version: PINS_VERSION,
      repos: [repo('octo', 'one'), repo('acme', 'two')],
      recent: false,
    };

    assert.deepEqual(parsePins(raw), { repos: raw.repos, recent: false });
  });

  it('drops invalid and case-insensitive duplicate repos', () => {
    const raw = {
      version: PINS_VERSION,
      repos: [
        repo('octo', 'one'),
        repo('OCTO', 'One'),
        repo('bad owner', 'x'),
        { owner: 'octo' },
        { owner: 1, name: 'x' },
        'octo/two',
        null,
        repo('octo', 'two'),
      ],
      recent: 'yes',
    };

    assert.deepEqual(parsePins(raw), {
      repos: [repo('octo', 'one'), repo('octo', 'two')],
      recent: true,
    });
  });

  it('treats missing repos as empty and caps the number of pins', () => {
    assert.deepEqual(parsePins({ version: PINS_VERSION }), { repos: [], recent: true });

    const many = Array.from({ length: MAX_PINS + 3 }, (_, index) => repo('octo', `r${index}`));
    assert.equal(parsePins({ version: PINS_VERSION, repos: many }).repos.length, MAX_PINS);
  });
});

describe('pin helpers', () => {
  it('parses a single repo', () => {
    assert.deepEqual(parseRepo(repo('octo', 'one')), repo('octo', 'one'));
    assert.equal(parseRepo(repo('octo', 'a/b')), null);
    assert.equal(parseRepo('octo/one'), null);
  });

  it('serializes with version and without extra fields', () => {
    const settings = { repos: [{ ...repo('octo', 'one'), fullName: 'octo/one' }], recent: false };

    assert.deepEqual(serializePins(settings), {
      version: PINS_VERSION,
      repos: [repo('octo', 'one')],
      recent: false,
    });
    assert.deepEqual(parsePins(serializePins(settings)), {
      repos: [repo('octo', 'one')],
      recent: false,
    });
  });

  it('compares settings by content', () => {
    const a = { repos: [repo('octo', 'one')], recent: true };
    assert.equal(samePins(a, { repos: [repo('octo', 'one')], recent: true }), true);
    assert.equal(samePins(a, { repos: [repo('octo', 'one')], recent: false }), false);
    assert.equal(samePins(a, { repos: [repo('Octo', 'one')], recent: true }), false);
  });

  it('adds pins once and only up to the limit', () => {
    let settings = addPin(defaultPins(), repo('octo', 'one'));
    assert.deepEqual(settings.repos, [repo('octo', 'one')]);
    assert.equal(isPinned(settings, repo('Octo', 'ONE')), true);
    assert.equal(repoKey(repo('Octo', 'ONE')), 'octo/one');

    assert.equal(addPin(settings, repo('OCTO', 'one')), settings);

    for (let index = 1; index < MAX_PINS; index += 1) {
      settings = addPin(settings, repo('octo', `r${index}`));
    }
    assert.equal(settings.repos.length, MAX_PINS);
    assert.equal(addPin(settings, repo('octo', 'more')), settings);
  });

  it('removes pins case-insensitively and sets the recent flag', () => {
    const settings = { repos: [repo('octo', 'one'), repo('octo', 'two')], recent: true };

    assert.deepEqual(removePin(settings, repo('OCTO', 'One')).repos, [repo('octo', 'two')]);
    assert.deepEqual(setRecent(settings, false), { ...settings, recent: false });
  });
});
