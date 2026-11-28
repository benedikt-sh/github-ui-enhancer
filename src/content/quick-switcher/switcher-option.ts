import type { HighlightRange } from '../../lib/highlight.ts';
import { splitHighlights } from '../../lib/highlight.ts';
import type { RepoVisibility } from '../../shared/types.ts';
import { h } from '../../ui/dom.ts';
import type { Child } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';
import type { IconName } from '../../ui/octicons.ts';
import type { SwitcherEntry } from './results.ts';

const VISIBILITY: Record<RepoVisibility, { readonly icon: IconName; readonly label: string }> = {
  public: { icon: 'repo', label: 'Public repository' },
  private: { icon: 'lock', label: 'Private repository' },
  internal: { icon: 'lock', label: 'Internal repository' },
};

function highlighted(text: string, ranges: readonly HighlightRange[]): Child[] {
  return splitHighlights(text, ranges).map((segment) =>
    segment.highlighted
      ? h('mark', { className: 'ghx-quick-switcher__mark' }, segment.text)
      : segment.text,
  );
}

/** Highlights of `text.slice(start, end)`, with the ranges moved into the slice. */
function highlightedSlice(
  text: string,
  ranges: readonly HighlightRange[],
  start: number,
  end: number,
): Child[] {
  const shifted = ranges.map(
    ([from, to]): HighlightRange => [Math.max(from, start) - start, Math.min(to, end) - start],
  );
  return highlighted(text.slice(start, end), shifted);
}

function badge(text: string, modifier: string): HTMLSpanElement {
  return h(
    'span',
    { className: ['ghx-quick-switcher__badge', `ghx-quick-switcher__badge--${modifier}`] },
    text,
  );
}

function visibilityIcon(visibility: RepoVisibility | null): HTMLSpanElement {
  const info = visibility === null ? null : VISIBILITY[visibility];
  const restricted = visibility === 'private' || visibility === 'internal';
  return h(
    'span',
    {
      className: [
        'ghx-quick-switcher__visibility',
        restricted && 'ghx-quick-switcher__visibility--restricted',
      ],
    },
    icon(info?.icon ?? 'repo', { label: info?.label }),
  );
}

function badges(entry: SwitcherEntry): HTMLSpanElement[] {
  return [
    entry.visibility === 'private' ? badge('Private', 'private') : null,
    entry.visibility === 'internal' ? badge('Internal', 'internal') : null,
    entry.archived ? badge('Archived', 'archived') : null,
    entry.fork ? badge('Fork', 'fork') : null,
  ].filter((item) => item !== null);
}

export interface SwitcherOptionOptions {
  readonly entry: SwitcherEntry;
  /** Referenced by `aria-activedescendant` of the input. */
  readonly id: string;
  readonly active: boolean;
}

/**
 * One listbox option. The option itself is the link, so a click with or without modifiers
 * behaves like any other link. It is not tabbable, the input drives the selection.
 */
export function switcherOption(options: SwitcherOptionOptions): HTMLLIElement {
  const { entry } = options;
  const nameStart = entry.fullName.indexOf('/') + 1;
  const ranges = entry.nameHighlights;
  return h(
    'li',
    { className: 'ghx-quick-switcher__item', role: 'presentation' },
    h(
      'a',
      {
        className: 'ghx-quick-switcher__option',
        id: options.id,
        role: 'option',
        'aria-selected': String(options.active),
        tabindex: '-1',
        href: entry.url,
        dataset: { key: entry.key },
      },
      visibilityIcon(entry.visibility),
      h(
        'span',
        { className: 'ghx-quick-switcher__main' },
        h(
          'span',
          { className: 'ghx-quick-switcher__name' },
          h(
            'span',
            { className: 'ghx-quick-switcher__owner' },
            highlightedSlice(entry.fullName, ranges, 0, nameStart),
          ),
          h(
            'span',
            { className: 'ghx-quick-switcher__repo' },
            highlightedSlice(entry.fullName, ranges, nameStart, entry.fullName.length),
          ),
        ),
        entry.description
          ? h(
              'span',
              { className: 'ghx-quick-switcher__description' },
              highlighted(entry.description, entry.descriptionHighlights),
            )
          : null,
      ),
      badges(entry),
      entry.recent
        ? h(
            'span',
            { className: 'ghx-quick-switcher__recent', title: 'You were active here recently' },
            icon('clock'),
            'Recent',
          )
        : null,
    ),
  );
}
