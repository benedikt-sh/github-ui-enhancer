import type { RepoSummary } from '../shared/types.ts';
import { mergeRanges, type HighlightRange } from './highlight.ts';
import { matchSubsequence } from './subsequence.ts';
import { foldText, toOriginalRange, wordStarts, type FoldedText } from './text-fold.ts';

export type { HighlightRange } from './highlight.ts';

export interface RepoSearchHighlights {
  /** Ranges into `repo.fullName`. */
  readonly fullName: readonly HighlightRange[];
  /** Ranges into `repo.description`, empty when it is null. */
  readonly description: readonly HighlightRange[];
}

export interface RepoSearchResult {
  readonly repo: RepoSummary;
  readonly score: number;
  readonly highlights: RepoSearchHighlights;
}

export interface RepoSearchOptions {
  /** Maximum number of results, defaults to {@link DEFAULT_SEARCH_LIMIT}. */
  readonly limit?: number;
  /** Only repos of this owner, compared case-insensitively. Empty means all owners. */
  readonly owner?: string;
  readonly includeArchived?: boolean;
}

export interface RepoSearcherOptions {
  /** Clock for the recency bonus in epoch milliseconds, read once per search. */
  readonly now?: () => number;
}

export interface RepoSearcher {
  readonly size: number;
  search(query: string, options?: RepoSearchOptions): RepoSearchResult[];
}

export const DEFAULT_SEARCH_LIMIT = 50;

// Per-term tiers are 10 apart and the extras within a tier stay below 5, so a stronger
// kind of match always outranks a weaker one for the same term. Recency adds at most 3.
const EXACT_NAME = 100;
const NAME_PREFIX = 90;
const NAME_WORD_START = 80;
const NAME_SUBSTRING = 70;
const OWNER = 60;
const SUBSEQUENCE = 30;
const SUBSEQUENCE_RANGE = 20;
const DESCRIPTION = 20;
const PATH_PARTS = 30;
const PATH_PARTS_RANGE = 15;
const COVERAGE_WEIGHT = 5;
const RECENCY_MAX = 3;
const RECENCY_DAYS = 30;
const ARCHIVED_PENALTY = 6;
const FORK_PENALTY = 3;
const DAY_MS = 86_400_000;

interface IndexedRepo {
  readonly repo: RepoSummary;
  /** Folded `owner/name`. */
  readonly full: FoldedText;
  readonly fullWordStarts: Uint8Array;
  readonly owner: string;
  readonly name: string;
  /** Index of the name inside `full.text`. */
  readonly nameStart: number;
  readonly description: FoldedText;
  readonly descriptionWordStarts: Uint8Array;
  readonly ownerKey: string;
  readonly pushedAt: number | null;
  /** Position when sorted by full name, used as the final tie-break. */
  readonly nameRank: number;
}

type Term =
  | { readonly kind: 'plain'; readonly text: string }
  | {
      readonly kind: 'path';
      readonly text: string;
      readonly owner: string;
      readonly name: string;
      readonly parts: readonly string[];
    };

/** Ranges are folded indices; they are mapped to the original only for returned results. */
interface TermMatch {
  readonly score: number;
  readonly full: readonly HighlightRange[];
  readonly description: readonly HighlightRange[];
}

interface Hit {
  readonly entry: IndexedRepo;
  readonly score: number;
  readonly matches: readonly TermMatch[];
}

function nameMatch(score: number, start: number, end: number): TermMatch {
  return { score, full: [[start, end]], description: [] };
}

function findWordStart(
  haystack: string,
  needle: string,
  firstIndex: number,
  marks: Uint8Array,
  offset: number,
): number {
  for (let i = firstIndex; i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (marks[offset + i] === 1) {
      return i;
    }
  }
  return -1;
}

function positionsToRanges(positions: readonly number[]): HighlightRange[] {
  return mergeRanges(positions.map((position) => [position, position + 1]));
}

function matchName(entry: IndexedRepo, term: string): TermMatch | null {
  const { name, nameStart } = entry;
  const index = name.indexOf(term);
  if (index === -1) {
    return null;
  }
  const coverage = COVERAGE_WEIGHT * (term.length / name.length);
  if (index === 0) {
    const score = term.length === name.length ? EXACT_NAME : NAME_PREFIX + coverage;
    return nameMatch(score, nameStart, nameStart + term.length);
  }
  const wordIndex = findWordStart(name, term, index, entry.fullWordStarts, nameStart);
  const start = nameStart + (wordIndex === -1 ? index : wordIndex);
  const score = (wordIndex === -1 ? NAME_SUBSTRING : NAME_WORD_START) + coverage;
  return nameMatch(score, start, start + term.length);
}

function matchOwner(entry: IndexedRepo, term: string): TermMatch | null {
  const { owner } = entry;
  const index = owner.indexOf(term);
  if (index === -1) {
    return null;
  }
  const coverage = term.length / owner.length;
  let score: number;
  let start = index;
  if (index === 0) {
    score = OWNER + (term.length === owner.length ? 5 : 3 + coverage);
  } else {
    const wordIndex = findWordStart(owner, term, index, entry.fullWordStarts, 0);
    start = wordIndex === -1 ? index : wordIndex;
    score = OWNER + (wordIndex === -1 ? 0 : 2) + coverage;
  }
  return nameMatch(score, start, start + term.length);
}

function matchFullSubsequence(entry: IndexedRepo, term: string): TermMatch | null {
  const match = matchSubsequence(entry.full.text, entry.fullWordStarts, term);
  if (match === null) {
    return null;
  }
  return {
    score: SUBSEQUENCE + SUBSEQUENCE_RANGE * match.quality,
    full: positionsToRanges(match.positions),
    description: [],
  };
}

function matchDescription(entry: IndexedRepo, term: string): TermMatch | null {
  const text = entry.description.text;
  const index = text.indexOf(term);
  if (index === -1) {
    return null;
  }
  const wordIndex = findWordStart(text, term, index, entry.descriptionWordStarts, 0);
  const start = wordIndex === -1 ? index : wordIndex;
  const earliness = 1 - start / text.length;
  const score = DESCRIPTION + (wordIndex === -1 ? 0 : 3) + earliness;
  return { score, full: [], description: [[start, start + term.length]] };
}

function matchPlainInFullName(entry: IndexedRepo, term: string): TermMatch | null {
  return matchName(entry, term) ?? matchOwner(entry, term) ?? matchFullSubsequence(entry, term);
}

interface SegmentMatch {
  /** 1 for an exact segment, down to 0.1 for a weak subsequence. */
  readonly quality: number;
  readonly ranges: readonly HighlightRange[];
}

const ANY_SEGMENT: SegmentMatch = { quality: 1, ranges: [] };

function matchSegment(
  entry: IndexedRepo,
  segment: string,
  offset: number,
  part: string,
): SegmentMatch | null {
  if (part === '') {
    return ANY_SEGMENT;
  }
  const index = segment.indexOf(part);
  if (index !== -1) {
    const coverage = part.length / segment.length;
    let quality: number;
    let start = index;
    if (index === 0) {
      quality = part.length === segment.length ? 1 : 0.7 + 0.1 * coverage;
    } else {
      const wordIndex = findWordStart(segment, part, index, entry.fullWordStarts, offset);
      start = wordIndex === -1 ? index : wordIndex;
      quality = (wordIndex === -1 ? 0.4 : 0.5) + 0.1 * coverage;
    }
    return { quality, ranges: [[offset + start, offset + start + part.length]] };
  }
  const match = matchSubsequence(
    entry.full.text,
    entry.fullWordStarts,
    part,
    offset,
    offset + segment.length,
  );
  if (match === null) {
    return null;
  }
  return { quality: 0.1 + 0.2 * match.quality, ranges: positionsToRanges(match.positions) };
}

/** `owner/name` style term: each side is matched against its own segment of the full name. */
function matchPath(entry: IndexedRepo, term: Extract<Term, { kind: 'path' }>): TermMatch | null {
  const owner = matchSegment(entry, entry.owner, 0, term.owner);
  const name = owner === null ? null : matchSegment(entry, entry.name, entry.nameStart, term.name);
  if (owner !== null && name !== null) {
    const quality = 0.4 * owner.quality + 0.6 * name.quality;
    return {
      score: OWNER + (EXACT_NAME - OWNER) * quality,
      full: [...owner.ranges, ...name.ranges],
      description: [],
    };
  }
  return matchPathParts(entry, term.parts);
}

/** Fallback when the slash does not line up: every part must still match the full name. */
function matchPathParts(entry: IndexedRepo, parts: readonly string[]): TermMatch | null {
  let total = 0;
  const full: HighlightRange[] = [];
  for (const part of parts) {
    const match = matchPlainInFullName(entry, part);
    if (match === null) {
      return null;
    }
    total += match.score;
    full.push(...match.full);
  }
  const average = total / parts.length / EXACT_NAME;
  return { score: PATH_PARTS + PATH_PARTS_RANGE * average, full, description: [] };
}

function matchTerm(entry: IndexedRepo, term: Term): TermMatch | null {
  const match =
    term.kind === 'plain' ? matchPlainInFullName(entry, term.text) : matchPath(entry, term);
  return match ?? matchDescription(entry, term.text);
}

function parseTerm(raw: string): Term | null {
  const text = foldText(raw).text;
  const slash = text.indexOf('/');
  if (slash === -1) {
    return text === '' ? null : { kind: 'plain', text };
  }
  const parts = text.split('/').filter((part) => part !== '');
  if (parts.length === 0) {
    return null;
  }
  return { kind: 'path', text, owner: text.slice(0, slash), name: text.slice(slash + 1), parts };
}

function parseQuery(query: string): Term[] {
  return query
    .split(/\s+/)
    .map(parseTerm)
    .filter((term) => term !== null);
}

function recencyBonus(pushedAt: number | null, now: number): number {
  if (pushedAt === null) {
    return 0;
  }
  const ageDays = Math.max(0, now - pushedAt) / DAY_MS;
  return RECENCY_MAX / (1 + ageDays / RECENCY_DAYS);
}

function penalty(repo: RepoSummary): number {
  return (repo.archived ? ARCHIVED_PENALTY : 0) + (repo.fork ? FORK_PENALTY : 0);
}

function parsePushedAt(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function indexRepo(repo: RepoSummary, nameRank: number): IndexedRepo {
  const full = foldText(repo.fullName);
  const slash = full.text.indexOf('/');
  const nameStart = slash + 1;
  const descriptionText = repo.description ?? '';
  const description = foldText(descriptionText);
  return {
    repo,
    full,
    fullWordStarts: wordStarts(repo.fullName, full),
    owner: full.text.slice(0, Math.max(slash, 0)),
    name: full.text.slice(nameStart),
    nameStart,
    description,
    descriptionWordStarts: wordStarts(descriptionText, description),
    ownerKey: repo.owner.toLowerCase(),
    pushedAt: parsePushedAt(repo.pushedAt),
    nameRank,
  };
}

function compareFullName(a: RepoSummary, b: RepoSummary): number {
  const left = a.fullName.toLowerCase();
  const right = b.fullName.toLowerCase();
  if (left !== right) {
    return left < right ? -1 : 1;
  }
  return a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0;
}

function compareRecent(a: IndexedRepo, b: IndexedRepo): number {
  const left = a.pushedAt ?? -Infinity;
  const right = b.pushedAt ?? -Infinity;
  return left !== right ? right - left : a.nameRank - b.nameRank;
}

function compareHits(a: Hit, b: Hit): number {
  return a.score !== b.score ? b.score - a.score : a.entry.nameRank - b.entry.nameRank;
}

function toResult(hit: Hit): RepoSearchResult {
  const { entry } = hit;
  const full: HighlightRange[] = [];
  const description: HighlightRange[] = [];
  for (const match of hit.matches) {
    for (const [start, end] of match.full) {
      full.push(toOriginalRange(entry.full, start, end));
    }
    for (const [start, end] of match.description) {
      description.push(toOriginalRange(entry.description, start, end));
    }
  }
  return {
    repo: entry.repo,
    score: hit.score,
    highlights: { fullName: mergeRanges(full), description: mergeRanges(description) },
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.max(0, Math.floor(limit));
}

const NO_HIGHLIGHTS: RepoSearchHighlights = { fullName: [], description: [] };

/**
 * Builds the search index once; `search` is meant to run on every keystroke.
 * The repos are not copied, so they must not be mutated afterwards.
 */
export function createRepoSearcher(
  repos: readonly RepoSummary[],
  options: RepoSearcherOptions = {},
): RepoSearcher {
  const now = options.now ?? Date.now;
  const byName = [...repos].sort(compareFullName);
  const entries = byName.map(indexRepo);
  const byRecency = [...entries].sort(compareRecent);

  function search(query: string, searchOptions: RepoSearchOptions = {}): RepoSearchResult[] {
    const limit = normalizeLimit(searchOptions.limit);
    const ownerFilter = searchOptions.owner?.trim().toLowerCase() ?? '';
    const includeArchived = searchOptions.includeArchived ?? false;
    const accepts = (entry: IndexedRepo): boolean =>
      (includeArchived || !entry.repo.archived) &&
      (ownerFilter === '' || entry.ownerKey === ownerFilter);
    if (limit === 0) {
      return [];
    }

    const terms = parseQuery(query);
    if (terms.length === 0) {
      const results: RepoSearchResult[] = [];
      for (const entry of byRecency) {
        if (results.length >= limit) {
          break;
        }
        if (accepts(entry)) {
          results.push({ repo: entry.repo, score: 0, highlights: NO_HIGHLIGHTS });
        }
      }
      return results;
    }

    const time = now();
    const hits: Hit[] = [];
    for (const entry of entries) {
      if (!accepts(entry)) {
        continue;
      }
      let score = 0;
      const matches: TermMatch[] = [];
      for (const term of terms) {
        const match = matchTerm(entry, term);
        if (match === null) {
          break;
        }
        score += match.score;
        matches.push(match);
      }
      if (matches.length === terms.length) {
        score += recencyBonus(entry.pushedAt, time) - penalty(entry.repo);
        hits.push({ entry, score, matches });
      }
    }
    hits.sort(compareHits);
    return hits.slice(0, limit).map(toResult);
  }

  return { size: entries.length, search };
}
