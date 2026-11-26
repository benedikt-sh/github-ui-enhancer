import type { LabelInfo } from '../shared/types.ts';
import { h } from './dom.ts';

const FALLBACK_COLOR = 'ededed';
export const DARK_TEXT = '#1f2328';
export const LIGHT_TEXT = '#ffffff';

/** Returns the color as lowercase six digit hex without "#", or null if it is not valid. */
export function normalizeHexColor(color: string): string | null {
  const value = color.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(value)) {
    return value;
  }
  if (/^[0-9a-f]{3}$/.test(value)) {
    return [...value].map((digit) => digit + digit).join('');
  }
  return null;
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a valid six digit hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((start) =>
    channelLuminance(Number.parseInt(hex.slice(start, start + 2), 16)),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Picks dark or light text, whichever has the higher WCAG contrast on the background. */
export function readableTextColor(background: string): string {
  const luminance = relativeLuminance(normalizeHexColor(background) ?? FALLBACK_COLOR);
  const darkLuminance = relativeLuminance(DARK_TEXT.slice(1));
  const contrastWithDark = (luminance + 0.05) / (darkLuminance + 0.05);
  const contrastWithLight = 1.05 / (luminance + 0.05);
  return contrastWithDark >= contrastWithLight ? DARK_TEXT : LIGHT_TEXT;
}

export function labelPill(label: LabelInfo): HTMLSpanElement {
  const color = normalizeHexColor(label.color) ?? FALLBACK_COLOR;
  return h(
    'span',
    {
      className: 'ghx-label',
      title: label.name,
      style: { backgroundColor: `#${color}`, color: readableTextColor(color) },
    },
    label.name,
  );
}

export function labelList(labels: readonly LabelInfo[]): HTMLSpanElement | null {
  if (labels.length === 0) {
    return null;
  }
  return h('span', { className: 'ghx-labels' }, labels.map(labelPill));
}
