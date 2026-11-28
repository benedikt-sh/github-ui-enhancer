/**
 * How a brand color is drawn so the icon stays visible on GitHub's light and dark canvas:
 * - `brand`: the color works on both.
 * - `mono`: black, white or gray logos take the text color, a shifted gray would look washed out.
 * - `darken`: too light for the light theme, `file-icons.css` darkens it there.
 * - `lighten`: too dark for the dark theme, `file-icons.css` lightens it there.
 */
export type IconTone = 'brand' | 'mono' | 'darken' | 'lighten';

export type Rgb = readonly [number, number, number];

const LIGHT_CANVAS: Rgb = [1, 1, 1];
/** `--bgColor-default` of GitHub's dark theme, the dimmed and high contrast ones are similar. */
const DARK_CANVAS: Rgb = [13 / 255, 17 / 255, 23 / 255];
/** Below this contrast ratio a 16px glyph blurs into the canvas. */
const MIN_CONTRAST = 2;
/** Colors whose channels differ less than this count as gray. */
const MAX_GRAY_CHROMA = 0.12;

export function iconTone(hex: string | null): IconTone {
  const rgb = hex === null ? null : parseHex(hex);
  if (rgb === null) {
    return 'mono';
  }
  const tooLight = contrastRatio(rgb, LIGHT_CANVAS) < MIN_CONTRAST;
  const tooDark = contrastRatio(rgb, DARK_CANVAS) < MIN_CONTRAST;
  if (!tooLight && !tooDark) {
    return 'brand';
  }
  if (Math.max(...rgb) - Math.min(...rgb) < MAX_GRAY_CHROMA) {
    return 'mono';
  }
  return tooLight ? 'darken' : 'lighten';
}

/** Channels in the range 0 to 1, `null` for anything but six hex digits. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    return null;
  }
  const value = Number.parseInt(match[1] ?? '', 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** WCAG 2 contrast ratio between 1 and 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminance([r, g, b]: Rgb): number {
  const linear = (value: number): number =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
