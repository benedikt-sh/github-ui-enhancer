import { isNonEmptyString, isOneOf, isRecord } from './guards.ts';

export const WIDGET_WIDTHS = ['half', 'full'] as const;

export type WidgetWidth = (typeof WIDGET_WIDTHS)[number];

export interface WidgetInstance {
  readonly id: string;
  readonly type: string;
  readonly width: WidgetWidth;
  /** Raw config, validated by the widget definition's `parseConfig`. */
  readonly config: unknown;
}

/** Singleton widgets are not part of the layout, the host places them itself. */
export interface DashboardLayout {
  readonly version: 1;
  readonly instances: readonly WidgetInstance[];
}

export function createId(): string {
  return crypto.randomUUID();
}

/**
 * Returns null when the stored value is not a layout at all. Single broken instances are
 * dropped so one bad entry does not cost the user the whole dashboard.
 */
export function parseLayout(raw: unknown): DashboardLayout | null {
  if (!isRecord(raw) || raw['version'] !== 1 || !Array.isArray(raw['instances'])) {
    return null;
  }
  const seen = new Set<string>();
  const instances: WidgetInstance[] = [];
  for (const entry of raw['instances']) {
    const instance = parseInstance(entry);
    if (instance !== null && !seen.has(instance.id)) {
      seen.add(instance.id);
      instances.push(instance);
    }
  }
  return { version: 1, instances };
}

function parseInstance(entry: unknown): WidgetInstance | null {
  if (!isRecord(entry) || !isNonEmptyString(entry['id']) || !isNonEmptyString(entry['type'])) {
    return null;
  }
  const width = isOneOf(WIDGET_WIDTHS, entry['width']) ? entry['width'] : 'half';
  return { id: entry['id'], type: entry['type'], width, config: entry['config'] };
}
