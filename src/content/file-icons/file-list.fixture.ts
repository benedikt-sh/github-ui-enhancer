/**
 * GitHub's React directory table on repository home and tree pages, modeled on
 * github.com/microsoft/TypeScript in November 2026 (path data and commit cells shortened).
 */

export type EntryKind = 'file' | 'directory' | 'submodule' | 'symlink';

export interface FileListFixtureEntry {
  readonly name: string;
  readonly kind?: EntryKind;
  /** Defaults to a blob or tree link below `/octo/repo/.../main/`. */
  readonly href?: string | null;
}

export interface FileListFixtureOptions {
  /** Adds the parent directory row of tree pages. */
  readonly parentRow?: boolean;
}

const ICON_CLASSES: Readonly<Record<EntryKind, string>> = {
  file: 'octicon octicon-file color-fg-muted',
  directory: 'octicon octicon-file-directory-fill icon-directory',
  submodule: 'octicon octicon-file-submodule color-fg-muted',
  symlink: 'octicon octicon-file-symlink-file color-fg-muted',
};

function octicon(kind: EntryKind): string {
  return (
    `<svg data-component="Octicon" aria-hidden="true" focusable="false" ` +
    `class="${ICON_CLASSES[kind]}" viewBox="0 0 16 16" width="16" height="16" ` +
    `fill="currentColor" display="inline-block" overflow="visible" ` +
    `style="vertical-align:text-bottom"><path d="M2 1.75C2 .784 2.784 0 3.75 0Z"></path></svg>`
  );
}

function nameCell(entry: FileListFixtureEntry, screen: 'small' | 'large'): string {
  const kind = entry.kind ?? 'file';
  const href =
    entry.href === undefined
      ? `/octo/repo/${kind === 'directory' ? 'tree' : 'blob'}/main/${entry.name}`
      : entry.href;
  const label = `${entry.name}, (${kind === 'directory' ? 'Directory' : 'File'})`;
  const hrefAttribute = href === null ? '' : ` href="${href}"`;
  return `
    <td class="react-directory-row-name-cell-${screen}-screen" colspan="${screen === 'small' ? 2 : 1}">
      <div class="react-directory-filename-column">${octicon(kind)}<div class="overflow-hidden">
        <div class="react-directory-filename-cell"><div class="react-directory-truncate">
          <a title="${entry.name}" aria-label="${label}" class="Link--primary"${hrefAttribute}
            data-discover="true">${entry.name}</a>
        </div></div>
      </div></div>
    </td>`;
}

export function fileListRow(entry: FileListFixtureEntry, index: number): string {
  return `
    <tr class="react-directory-row undefined" id="folder-row-${index}">
      ${nameCell(entry, 'small')}
      ${nameCell(entry, 'large')}
      <td class="react-directory-row-commit-cell"><div><div class="react-directory-commit-message">
        <a class="Link--secondary" href="/octo/repo/commit/abc">Update things</a>
      </div></div></td>
      <td><div class="react-directory-commit-age">Nov 4, 2026</div></td>
    </tr>`;
}

const PARENT_ROW = `
  <tr id="folder-row-0" class="Box_3__JB-qy4"><td colspan="3" class="f5 text-normal tmp-px-3">
    <h3 class="sr-only" data-testid="screen-reader-heading">parent directory</h3>
    <a aria-label="Parent directory" data-testid="up-tree" rel="nofollow" href="/octo/repo/tree/main">
      <div class="width-full Box__8gZdPk">${octicon('directory')}..</div>
    </a>
  </td></tr>`;

export function fileListMarkup(
  entries: readonly FileListFixtureEntry[],
  options: FileListFixtureOptions = {},
): string {
  return `
    <h2 id="folders-and-files" class="sr-only">Folders and files</h2>
    <table aria-labelledby="folders-and-files" class="Box__0K17vj OverviewTable__rPbUfl">
      <thead><tr><th colspan="2">Name</th><th colspan="1">Name</th>
        <th class="hide-sm">Last commit message</th><th>Last commit date</th></tr></thead>
      <tbody>
        ${options.parentRow === true ? PARENT_ROW : ''}
        ${entries.map((entry, index) => fileListRow(entry, index + 1)).join('')}
        <tr class="d-none" data-testid="view-all-files-row"><td colspan="3"><div>
          <button>View all files</button>
        </div></td></tr>
      </tbody>
    </table>`;
}

export function renderFileList(
  document: Document,
  entries: readonly FileListFixtureEntry[],
  options: FileListFixtureOptions = {},
): void {
  document.body.innerHTML = `<main>${fileListMarkup(entries, options)}</main>`;
}

export interface FileTreeFixtureEntry {
  /** Full path inside the repository, also the item id. */
  readonly path: string;
  readonly kind?: 'file' | 'directory';
}

/**
 * GitHub's file tree next to file and directory pages, modeled on github.com/nodejs/node in
 * November 2026 (Primer TreeView, class name hashes shortened).
 */
export function fileTreeMarkup(entries: readonly FileTreeFixtureEntry[]): string {
  const items = entries.map((entry) => {
    const kind = entry.kind ?? 'file';
    const name = entry.path.split('/').pop() ?? entry.path;
    const icon =
      kind === 'directory'
        ? `<div class="PRIVATE_TreeView-directory-icon">${octicon('directory')}</div>`
        : octicon('file');
    return `
      <li id="${entry.path}-item" role="treeitem" aria-level="${entry.path.split('/').length}"
        class="PRIVATE_TreeView-item"${kind === 'directory' ? ' aria-expanded="false"' : ''}>
        <div class="PRIVATE_TreeView-item-container">
          <div class="PRIVATE_TreeView-item-content">
            <div class="PRIVATE_TreeView-item-visual prc-TreeView-TreeViewItemVisual-naWzj">${icon}</div>
            <span class="PRIVATE_TreeView-item-content-text"><span>${name}</span></span>
          </div>
        </div>
      </li>`;
  });
  return `
    <nav aria-label="File Tree Navigation">
      <ul role="tree" aria-label="Files">${items.join('')}</ul>
    </nav>`;
}
