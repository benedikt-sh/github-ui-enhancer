import type { HighlightRange, RepoSearchResult } from '../../lib/fuzzy.ts';
import { splitHighlights } from '../../lib/highlight.ts';
import type { RepoSummary, RepoVisibility } from '../../shared/types.ts';
import { h, safeUrl } from '../../ui/dom.ts';
import type { Child } from '../../ui/dom.ts';
import { icon } from '../../ui/octicons.ts';
import type { IconName } from '../../ui/octicons.ts';
import { repoUrl } from '../../ui/row.ts';
import { relativeTime } from '../../ui/time.ts';

/** Text with every highlighted range wrapped in `<mark>`. */
export function highlightedText(text: string, ranges: readonly HighlightRange[]): Child[] {
  return splitHighlights(text, ranges).map((segment) =>
    segment.highlighted
      ? h('mark', { className: 'ghx-repo-search__mark' }, segment.text)
      : segment.text,
  );
}

/** Highlights of `text.slice(start, end)`, with ranges moved into the slice. */
function highlightedSlice(
  text: string,
  ranges: readonly HighlightRange[],
  start: number,
  end: number,
): Child[] {
  const shifted = ranges.map(
    ([from, to]): HighlightRange => [Math.max(from, start) - start, Math.min(to, end) - start],
  );
  return highlightedText(text.slice(start, end), shifted);
}

export function repoHref(repo: RepoSummary): string {
  return safeUrl(repo.url) ?? repoUrl(repo);
}

const VISIBILITY: Record<RepoVisibility, { readonly icon: IconName; readonly label: string }> = {
  public: { icon: 'repo', label: 'Public repository' },
  private: { icon: 'lock', label: 'Private repository' },
  internal: { icon: 'lock', label: 'Internal repository' },
};

function badge(text: string, modifier: string): HTMLSpanElement {
  return h(
    'span',
    { className: ['ghx-repo-search__badge', `ghx-repo-search__badge--${modifier}`] },
    text,
  );
}

function fullName(result: RepoSearchResult): HTMLSpanElement {
  const text = result.repo.fullName;
  const ranges = result.highlights.fullName;
  const nameStart = text.indexOf('/') + 1;
  return h(
    'span',
    { className: 'ghx-repo-search__name' },
    h(
      'span',
      { className: 'ghx-repo-search__owner' },
      highlightedSlice(text, ranges, 0, nameStart),
    ),
    h(
      'span',
      { className: 'ghx-repo-search__repo' },
      highlightedSlice(text, ranges, nameStart, text.length),
    ),
  );
}

export interface ResultOptionOptions {
  readonly result: RepoSearchResult;
  /** Element id, referenced by `aria-activedescendant` of the input. */
  readonly id: string;
  readonly active: boolean;
  readonly now: number;
}

/**
 * One listbox option. The option itself is the link, so a mouse click (also with modifiers or
 * the middle button) behaves like any other link. It is not tabbable, the input drives it.
 */
export function resultOption(options: ResultOptionOptions): HTMLLIElement {
  const { repo, highlights } = options.result;
  const visibility = VISIBILITY[repo.visibility];
  return h(
    'li',
    { className: 'ghx-repo-search__item', role: 'presentation' },
    h(
      'a',
      {
        className: 'ghx-repo-search__option',
        id: options.id,
        role: 'option',
        'aria-selected': String(options.active),
        tabindex: '-1',
        href: repoHref(repo),
        dataset: { repoId: repo.id },
      },
      h(
        'span',
        {
          className: [
            'ghx-repo-search__visibility',
            repo.visibility !== 'public' && 'ghx-repo-search__visibility--restricted',
          ],
          title: visibility.label,
        },
        icon(visibility.icon, { label: visibility.label }),
      ),
      h(
        'span',
        { className: 'ghx-repo-search__main' },
        h(
          'span',
          { className: 'ghx-repo-search__title-line' },
          fullName(options.result),
          repo.archived ? badge('Archived', 'archived') : null,
          repo.fork ? badge('Fork', 'fork') : null,
        ),
        repo.description
          ? h(
              'span',
              { className: 'ghx-repo-search__description' },
              highlightedText(repo.description, highlights.description),
            )
          : null,
      ),
      repo.pushedAt
        ? h(
            'span',
            { className: 'ghx-repo-search__pushed' },
            'Updated ',
            relativeTime(repo.pushedAt, options.now),
          )
        : null,
    ),
  );
}
