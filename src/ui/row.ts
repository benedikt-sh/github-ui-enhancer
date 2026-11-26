import type { Actor, LabelInfo, RepoRef } from '../shared/types.ts';
import { h, safeUrl } from './dom.ts';
import type { Child, ClassValue } from './dom.ts';
import { labelList } from './label.ts';
import { icon } from './octicons.ts';
import type { IconName } from './octicons.ts';

export type Tone = 'default' | 'muted' | 'accent' | 'success' | 'danger' | 'done' | 'attention';

export interface Status {
  readonly icon: IconName;
  readonly tone: Tone;
  /** Accessible name and tooltip. */
  readonly label: string;
}

export function toneClass(tone: Tone): string {
  return `ghx-tone--${tone}`;
}

/** A labeled status icon, e.g. the state of a pull request or the result of its checks. */
export function statusIcon(status: Status, className?: ClassValue): HTMLSpanElement {
  return h(
    'span',
    { className: ['ghx-status', toneClass(status.tone), className], title: status.label },
    icon(status.icon, { label: status.label }),
  );
}

/** Icon plus visible text, for statuses that should be readable without hovering. */
export function statusText(status: Status): HTMLSpanElement {
  return h(
    'span',
    { className: ['ghx-status-text', toneClass(status.tone)] },
    icon(status.icon),
    status.label,
  );
}

export function repoUrl(repo: RepoRef): string {
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

export function repoLink(repo: RepoRef): HTMLAnchorElement {
  return h(
    'a',
    { className: 'ghx-row__repo', href: repoUrl(repo) },
    `${repo.owner}/${repo.name}`,
  );
}

/** Falls back to plain text if the URL is not http(s). */
export function link(text: string, url: string, className?: ClassValue): HTMLElement {
  const href = safeUrl(url);
  return href ? h('a', { className, href }, text) : h('span', { className }, text);
}

/** GitHub shows deleted accounts as "ghost". */
export function actorLink(actor: Actor | null): HTMLElement {
  if (!actor) {
    return h('span', { className: 'ghx-actor' }, 'ghost');
  }
  return link(actor.login, actor.url, 'ghx-actor');
}

export function avatar(actor: Actor): HTMLImageElement | null {
  const src = safeUrl(actor.avatarUrl);
  if (!src) {
    return null;
  }
  return h('img', {
    className: 'ghx-avatar',
    src,
    alt: `@${actor.login}`,
    title: actor.login,
    width: 20,
    height: 20,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
}

export function avatarStack(
  actors: readonly Actor[],
  label: string,
  max = 3,
): HTMLSpanElement | null {
  const images = actors.map(avatar).filter((image) => image !== null);
  if (images.length === 0) {
    return null;
  }
  const hidden = images.length - max;
  return h(
    'span',
    {
      className: 'ghx-avatars',
      role: 'group',
      'aria-label': `${label}: ${actors.map((actor) => actor.login).join(', ')}`,
    },
    images.slice(0, max),
    hidden > 0
      ? h('span', { className: 'ghx-avatars__more', 'aria-hidden': 'true' }, `+${hidden}`)
      : null,
  );
}

export function commentCount(count: number): HTMLSpanElement | null {
  if (count <= 0) {
    return null;
  }
  const label = `${count} comment${count === 1 ? '' : 's'}`;
  return h(
    'span',
    { className: 'ghx-row__comments', title: label, 'aria-label': label, role: 'img' },
    icon('comment'),
    h('span', { 'aria-hidden': 'true' }, count),
  );
}

export interface ItemRowOptions {
  readonly id: string | number;
  readonly status: Status;
  readonly title: string;
  readonly url: string;
  readonly repo?: RepoRef | null;
  readonly labels?: readonly LabelInfo[];
  readonly meta?: readonly Child[];
  readonly side?: readonly Child[];
  readonly className?: ClassValue;
}

function isPresent(child: Child): boolean {
  return child !== null && child !== undefined && child !== false && child !== '';
}

/** The common row layout: status icon, title line with labels, meta line and a side column. */
export function itemRow(options: ItemRowOptions): HTMLLIElement {
  const meta = (options.meta ?? []).filter(isPresent);
  const side = (options.side ?? []).filter(isPresent);
  return h(
    'li',
    { className: ['ghx-row', options.className], dataset: { id: String(options.id) } },
    statusIcon(options.status, 'ghx-row__icon'),
    h(
      'div',
      { className: 'ghx-row__main' },
      h(
        'div',
        { className: 'ghx-row__title-line' },
        options.repo ? repoLink(options.repo) : null,
        link(options.title, options.url, 'ghx-row__title'),
        labelList(options.labels ?? []),
      ),
      meta.length > 0
        ? h('div', { className: 'ghx-row__meta' }, meta.map(metaItem))
        : null,
    ),
    side.length > 0 ? h('div', { className: 'ghx-row__side' }, side) : null,
  );
}

function metaItem(child: Child): HTMLSpanElement {
  return h('span', { className: 'ghx-row__meta-item' }, child);
}

export interface ItemListOptions {
  readonly label: string;
  readonly className?: ClassValue;
}

export function itemList(
  rows: readonly HTMLLIElement[],
  options: ItemListOptions,
): HTMLUListElement {
  return h('ul', { className: ['ghx-list', options.className], 'aria-label': options.label }, rows);
}
