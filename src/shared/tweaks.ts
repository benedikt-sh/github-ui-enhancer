import { isRecord } from './guards.ts';

export interface TweakArea {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const TWEAK_AREAS = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'The GitHub start page you see when you open github.com while signed in.',
  },
  {
    id: 'header',
    title: 'Header bar',
    description: 'The bar at the top of every GitHub page.',
  },
] as const satisfies readonly TweakArea[];

export type TweakAreaId = (typeof TWEAK_AREAS)[number]['id'];

export interface TweakDefinition {
  readonly id: string;
  readonly area: TweakAreaId;
  readonly title: string;
  readonly description: string;
  readonly defaultValue: boolean;
}

export const TWEAKS = [
  {
    id: 'dashboard.enhanced',
    area: 'dashboard',
    title: 'Enhanced dashboard',
    description: "Replace GitHub's start page with the configurable widget dashboard.",
    defaultValue: true,
  },
  {
    id: 'dashboard.hideChangelog',
    area: 'dashboard',
    title: "Hide GitHub's changelog",
    description: 'Hide the changelog widget with the latest GitHub announcements.',
    defaultValue: false,
  },
  {
    id: 'header.pinnedRepos',
    area: 'header',
    title: 'Pinned repositories',
    description:
      'Show pinned repositories, and optionally the one you were active in most recently, ' +
      'as quick links in the header bar.',
    defaultValue: false,
  },
] as const satisfies readonly TweakDefinition[];

export type TweakId = (typeof TWEAKS)[number]['id'];

export type TweakSettings = Readonly<Record<TweakId, boolean>>;

export function defaultTweaks(): TweakSettings {
  return parseTweaks(undefined);
}

/** Unknown keys are dropped and every missing or invalid value falls back to its default. */
export function parseTweaks(raw: unknown): TweakSettings {
  const stored = isRecord(raw) ? raw : {};
  const settings = {} as Record<TweakId, boolean>;
  for (const tweak of TWEAKS) {
    const value = stored[tweak.id];
    settings[tweak.id] = typeof value === 'boolean' ? value : tweak.defaultValue;
  }
  return settings;
}

export type Tweak = (typeof TWEAKS)[number];

export function tweaksOfArea(area: TweakAreaId): readonly Tweak[] {
  return TWEAKS.filter((tweak) => tweak.area === area);
}
