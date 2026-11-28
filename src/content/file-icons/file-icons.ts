import { SVG_NAMESPACE } from '../../ui/dom.ts';
import {
  fileListCellOf,
  findFileListCells,
  isRepositoryCodePath,
  readFileListEntry,
} from '../mount/selectors.ts';
import type { Toggleable } from '../tweaks/apply-tweaks.ts';
import { FILE_ICONS } from './icon-data.ts';
import type { FileIconId } from './icon-data.ts';
import { iconTone } from './icon-tone.ts';
import { resolveFileIcon } from './resolve-icon.ts';

export const ICON_CLASS = 'ghx-file-icon';
/** Set on our icons, the value is the icon id. */
export const ICON_ATTRIBUTE = 'data-ghx-file-icon';
/** Set on GitHub's icons we cover, `file-icons.css` hides them. */
export const REPLACED_ATTRIBUTE = 'data-ghx-file-icon-replaced';
const ELEMENT_NODE = 1;

export interface FileIconsOptions {
  readonly document: Document;
  readonly window: Pick<Window, 'location'> & Pick<typeof globalThis, 'MutationObserver'>;
}

/**
 * GitHub renders the file list client-side, re-renders rows lazily and reuses them across
 * navigation, so every mutation is mapped to the affected name cells and only those are checked.
 */
export function createFileIcons(options: FileIconsOptions): Toggleable {
  const { document, window } = options;
  let observer: MutationObserver | null = null;
  let replaced = false;

  function onCodePage(): boolean {
    return isRepositoryCodePath(window.location.pathname);
  }

  function handle(records: readonly MutationRecord[]): void {
    if (!onCodePage()) {
      if (replaced) {
        restoreAll();
      }
      return;
    }
    const cells = new Set<Element>();
    for (const record of records) {
      const cell = fileListCellOf(record.target);
      if (cell !== null) {
        cells.add(cell);
      }
      for (const node of record.addedNodes) {
        if (isElement(node)) {
          findFileListCells(node).forEach((found) => cells.add(found));
        }
      }
    }
    cells.forEach(update);
  }

  function update(cell: Element): void {
    const entry = readFileListEntry(cell);
    const id = entry === null ? null : resolveFileIcon(entry.path);
    const current = ownIcon(cell);
    if (entry === null || id === null) {
      current?.remove();
      showGitHubIcons(cell);
      return;
    }
    const upToDate =
      current?.getAttribute(ICON_ATTRIBUTE) === id &&
      current.nextElementSibling === entry.icon &&
      entry.icon.hasAttribute(REPLACED_ATTRIBUTE);
    if (upToDate) {
      return;
    }
    current?.remove();
    showGitHubIcons(cell);
    entry.icon.before(createIcon(document, id));
    entry.icon.setAttribute(REPLACED_ATTRIBUTE, '');
    replaced = true;
  }

  function restoreAll(): void {
    replaced = false;
    document.querySelectorAll(`.${ICON_CLASS}[${ICON_ATTRIBUTE}]`).forEach((icon) => icon.remove());
    document
      .querySelectorAll(`[${REPLACED_ATTRIBUTE}]`)
      .forEach((icon) => icon.removeAttribute(REPLACED_ATTRIBUTE));
  }

  return {
    start() {
      if (observer !== null) {
        return;
      }
      observer = new window.MutationObserver(handle);
      observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'class'],
      });
      if (onCodePage()) {
        findFileListCells(document).forEach(update);
      }
    },
    stop() {
      observer?.disconnect();
      observer = null;
      restoreAll();
    },
  };
}

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function ownIcon(cell: Element): Element | null {
  return [...cell.children].find((child) => child.hasAttribute(ICON_ATTRIBUTE)) ?? null;
}

function showGitHubIcons(cell: Element): void {
  for (const child of cell.children) {
    child.removeAttribute(REPLACED_ATTRIBUTE);
  }
}

export function createIcon(document: Document, id: FileIconId): SVGSVGElement {
  const data = FILE_ICONS[id];
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('class', `${ICON_CLASS} ${ICON_CLASS}--${iconTone(data.hex)}`);
  icon.setAttribute(ICON_ATTRIBUTE, id);
  icon.setAttribute('viewBox', `0 0 ${data.size} ${data.size}`);
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  if (data.hex !== null) {
    icon.style.setProperty('--ghx-file-icon-color', `#${data.hex}`);
  }
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', data.path);
  icon.append(path);
  return icon;
}
