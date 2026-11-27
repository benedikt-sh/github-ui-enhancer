/**
 * The only place that knows GitHub's markup. `mount.css` repeats the container selectors for
 * the early hiding at `document_start`, so both have to be changed together.
 */

export const USER_LOGIN_META = 'meta[name="user-login"]';

/** Tried in order, the first match becomes the container the dashboard is prepended to. */
export const CONTAINER_SELECTORS = ['main', '[role="main"]', '.application-main'] as const;

/** Last resort: the dashboard is inserted right after the first matching header element. */
export const HEADER_SELECTORS = [
  '.js-header-wrapper',
  'header.AppHeader',
  'header[role="banner"]',
  'body header',
] as const;

export type MountPlacement = 'first-child' | 'after-header';

export type MountPoint =
  | { readonly placement: 'first-child'; readonly container: Element }
  | { readonly placement: 'after-header'; readonly container: Element; readonly header: Element };

export function isStartPath(pathname: string): boolean {
  return pathname === '/';
}

/** Logged-out visitors get the marketing page on `/`, where the meta tag is empty. */
export function isLoggedIn(document: Document): boolean {
  return pageLogin(document) !== null;
}

export function pageLogin(document: Document): string | null {
  const content = document.querySelector(USER_LOGIN_META)?.getAttribute('content')?.trim() ?? '';
  return content === '' ? null : content;
}

/**
 * `exclude` is the extension's own root. Matches inside it are skipped, so widgets rendering a
 * `<main>` or `<header>` can never become the mount point.
 */
export function findMountPoint(document: Document, exclude: Element | null): MountPoint | null {
  for (const selector of CONTAINER_SELECTORS) {
    const container = firstOutside(document, selector, exclude);
    if (container !== null) {
      return { placement: 'first-child', container };
    }
  }
  for (const selector of HEADER_SELECTORS) {
    const header = firstOutside(document, selector, exclude);
    const container = header?.parentElement ?? null;
    if (header !== null && container !== null) {
      return { placement: 'after-header', container, header };
    }
  }
  return null;
}

function firstOutside(document: Document, selector: string, exclude: Element | null) {
  for (const element of document.querySelectorAll(selector)) {
    if (exclude === null || !exclude.contains(element)) {
      return element;
    }
  }
  return null;
}

/** Known hooks of GitHub's changelog widget, tried before the link heuristic below. */
export const CHANGELOG_SELECTORS = [
  '.dashboard-changelog',
  '[data-testid*="changelog" i]',
  '[aria-label*="changelog" i]',
] as const;

const CHANGELOG_LINK = 'a[href^="https://github.blog/changelog"]';
const BLOG_ORIGIN = 'https://github.blog/';
const STOP_AT = 'main, body, html';

/**
 * GitHub's widget markup changes often, its links to the GitHub blog do not. The widget is the
 * largest ancestor of such a link that contains nothing but blog links.
 */
export function findChangelogWidgets(document: Document, exclude: Element | null): Element[] {
  const found: Element[] = [];
  const add = (element: Element): void => {
    const inside = exclude?.contains(element) === true;
    if (!inside && !found.some((known) => known.contains(element))) {
      found.push(element);
    }
  };
  for (const selector of CHANGELOG_SELECTORS) {
    document.querySelectorAll(selector).forEach(add);
  }
  document.querySelectorAll(CHANGELOG_LINK).forEach((link) => add(changelogCard(link)));
  return found;
}

function changelogCard(link: Element): Element {
  let card = link;
  for (let parent = link.parentElement; parent !== null; parent = parent.parentElement) {
    if (parent.matches(STOP_AT) || !onlyBlogLinks(parent)) {
      break;
    }
    card = parent;
  }
  return card;
}

function onlyBlogLinks(element: Element): boolean {
  return [...element.querySelectorAll('a[href]')].every((link) =>
    (link.getAttribute('href') ?? '').startsWith(BLOG_ORIGIN),
  );
}
