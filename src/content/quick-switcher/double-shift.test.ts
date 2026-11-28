import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDoubleShiftDetector, DOUBLE_SHIFT_INTERVAL_MS } from './double-shift.ts';
import type { DoubleShiftDetector, KeyPress } from './double-shift.ts';

function press(key: string, overrides: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

const SHIFT = press('Shift');

function setup(interval?: number): { detector: DoubleShiftDetector; clock: { time: number } } {
  const clock = { time: 1_000 };
  return { detector: createDoubleShiftDetector(() => clock.time, interval), clock };
}

describe('createDoubleShiftDetector', () => {
  it('triggers on two Shift presses within the interval', () => {
    const { detector, clock } = setup();
    assert.equal(detector.keydown(SHIFT), false);
    clock.time += 200;
    assert.equal(detector.keydown(SHIFT), true);
  });

  it('accepts a gap of exactly the interval', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += DOUBLE_SHIFT_INTERVAL_MS;
    assert.equal(detector.keydown(SHIFT), true);
  });

  it('treats a late second press as a new first press', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += DOUBLE_SHIFT_INTERVAL_MS + 1;
    assert.equal(detector.keydown(SHIFT), false);
    clock.time += 100;
    assert.equal(detector.keydown(SHIFT), true);
  });

  it('honours a custom interval', () => {
    const { detector, clock } = setup(100);
    detector.keydown(SHIFT);
    clock.time += 150;
    assert.equal(detector.keydown(SHIFT), false);
  });

  it('needs two new presses after a trigger', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), true);
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), false);
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), true);
  });

  it('is cancelled by any other key in between', () => {
    for (const key of ['A', 'a', 'Enter', 'Control', 'Alt', 'Meta', 'Process', 'Dead', ' ']) {
      const { detector, clock } = setup();
      detector.keydown(SHIFT);
      clock.time += 50;
      assert.equal(detector.keydown(press(key)), false, key);
      clock.time += 50;
      assert.equal(detector.keydown(SHIFT), false, key);
    }
  });

  it('does not trigger while typing two capital letters', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    detector.keydown(press('A'));
    clock.time += 80;
    assert.equal(detector.keydown(SHIFT), false);
    assert.equal(detector.keydown(press('B')), false);
  });

  it('ignores the auto-repeat of a held Shift', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += 30;
    assert.equal(detector.keydown(press('Shift', { repeat: true })), false);
    clock.time += 30;
    assert.equal(detector.keydown(press('Shift', { repeat: true })), false);
  });

  it('does not count a press after a held Shift as the second tap', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += 100;
    detector.keydown(press('Shift', { repeat: true }));
    clock.time += 100;
    assert.equal(detector.keydown(SHIFT), false);
    clock.time += 100;
    assert.equal(detector.keydown(SHIFT), true);
  });

  for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
    it(`ignores Shift while ${modifier} is held`, () => {
      const { detector, clock } = setup();
      assert.equal(detector.keydown(press('Shift', { [modifier]: true })), false);
      clock.time += 50;
      assert.equal(detector.keydown(press('Shift', { [modifier]: true })), false);
    });

    it(`cancels a pending tap when the second press holds ${modifier}`, () => {
      const { detector, clock } = setup();
      detector.keydown(SHIFT);
      clock.time += 50;
      assert.equal(detector.keydown(press('Shift', { [modifier]: true })), false);
      clock.time += 50;
      assert.equal(detector.keydown(SHIFT), false);
    });
  }

  it('ignores Shift during an IME composition', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    clock.time += 50;
    assert.equal(detector.keydown(press('Shift', { isComposing: true })), false);
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), false);
  });

  it('does not trigger when both presses happen during a composition', () => {
    const { detector, clock } = setup();
    assert.equal(detector.keydown(press('Shift', { isComposing: true })), false);
    clock.time += 50;
    assert.equal(detector.keydown(press('Shift', { isComposing: true })), false);
  });

  it('forgets a pending tap on reset', () => {
    const { detector, clock } = setup();
    detector.keydown(SHIFT);
    detector.reset();
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), false);
    clock.time += 50;
    assert.equal(detector.keydown(SHIFT), true);
  });
});
