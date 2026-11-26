export interface SourceFile {
  path: string;
  content: string;
}

export interface LongDashHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

const LONG_DASH = /[\u2013\u2014]/g;

export function findLongDashes(files: readonly SourceFile[]): LongDashHit[] {
  const hits: LongDashHit[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(LONG_DASH)) {
        hits.push({ path: file.path, line: index + 1, column: match.index + 1, text });
      }
    });
  }
  return hits;
}

const CHECKED_EXTENSIONS = ['.ts', '.js', '.json', '.md', '.css', '.html', '.yml', '.yaml'];

export function isCheckedFile(path: string): boolean {
  if (path.startsWith('node_modules/') || path === 'package-lock.json') {
    return false;
  }
  return CHECKED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function formatHit(hit: LongDashHit): string {
  return `${hit.path}:${hit.line}:${hit.column}: ${hit.text.trim()}`;
}
