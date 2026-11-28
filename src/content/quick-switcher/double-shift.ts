/** Longest gap between the two Shift presses, in milliseconds. */
export const DOUBLE_SHIFT_INTERVAL_MS = 350;

/** The parts of a `KeyboardEvent` the detector looks at. */
export interface KeyPress {
  readonly key: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface DoubleShiftDetector {
  /** Feeds every keydown, returns true when it completes a double Shift. */
  keydown(event: KeyPress): boolean;
  /** Forgets a pending first press, e.g. after a click or when the window loses focus. */
  reset(): void;
}

function isPlainShift(event: KeyPress): boolean {
  // Keys an IME consumes arrive as `Process`, which is not `Shift` and cancels like any key.
  return (
    event.key === 'Shift' &&
    !event.repeat &&
    !event.isComposing &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

/**
 * Detects two quick taps of Shift with nothing else in between. Any other key, an auto-repeat
 * of a held Shift, a held modifier or an active IME composition cancels a pending first tap,
 * so typing capital letters never triggers it.
 */
export function createDoubleShiftDetector(
  now: () => number,
  interval = DOUBLE_SHIFT_INTERVAL_MS,
): DoubleShiftDetector {
  let firstPressAt: number | null = null;

  return {
    keydown(event) {
      if (!isPlainShift(event)) {
        firstPressAt = null;
        return false;
      }
      const time = now();
      if (firstPressAt !== null && time - firstPressAt <= interval) {
        firstPressAt = null;
        return true;
      }
      firstPressAt = time;
      return false;
    },
    reset() {
      firstPressAt = null;
    },
  };
}
