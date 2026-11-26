import type { RepoSummary } from '../shared/types.ts';
import { mergeRanges, type HighlightRange } from './highlight.ts';
import { matchSubsequence, NOT_A_SUBSEQUENCE } from './subsequence.ts';
import { createTopK } from './top-k.ts';
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

interface PlainTerm {
  readonly kind: 'plain';
  readonly text: string;
}

interface PathTerm {
  readonly kind: 'path';
  readonly text: string;
  readonly owner: string;
  readonly name: string;
  readonly parts: readonly string[];
}

type Term = PlainTerm | PathTerm;

const NO_MATCH = -1;

/**
 * Collects highlight ranges in folded indices. Matching runs without a sink while ranking
 * all repos and again with one only for the returned results, to keep keystrokes cheap.
 */
interface RangeSink {
  readonly full: HighlightRange[];
  readonly description: HighlightRange[];
}

interface Hit {
  readonly entry: IndexedRepo;
  readonly score: number;
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

function pushPositions(ranges: HighlightRange[], positions: readonly number[]): void {
  for (const position of positions) {
    ranges.push([position, position + 1]);
  }
}

function matchName(entry: IndexedRepo, term: string, sink: RangeSink | null): number {
  const { name, nameStart } = entry;
  const index = name.indexOf(term);
  if (index === -1) {
    return NO_MATCH;
  }
  const coverage = COVERAGE_WEIGHT * (term.length / name.length);
  let score: number;
  let start = index;
  if (index === 0) {
    score = term.length === name.length ? EXACT_NAME : NAME_PREFIX + coverage;
  } else {
    const wordIndex = findWordStart(name, term, index, entry.fullWordStarts, nameStart);
    start = wordIndex === -1 ? index : wordIndex;
    score = (wordIndex === -1 ? NAME_SUBSTRING : NAME_WORD_START) + coverage;
  }
  sink?.full.push([nameStart + start, nameStart + start + term.length]);
  return score;
}

function matchOwner(entry: IndexedRepo, term: string, sink: RangeSink | null): number {
  const { owner } = entry;
  const index = owner.indexOf(term);
  if (index === -1) {
    return NO_MATCH;
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
  sink?.full.push([start, start + term.length]);
  return score;
}

function matchFullSubsequence(entry: IndexedRepo, term: string, sink: RangeSink | null): number {
  const { text } = entry.full;
  const positions = sink === null ? null : [];
  const quality = matchSubsequence(text, entry.fullWordStarts, term, 0, text.length, positions);
  if (quality === NOT_A_SUBSEQUENCE) {
    return NO_MATCH;
  }
  if (sink !== null && positions !== null) {
    pushPositions(sink.full, positions);
  }
  return SUBSEQUENCE + SUBSEQUENCE_RANGE * quality;
}

function matchDescription(entry: IndexedRepo, term: string, sink: RangeSink | null): number {
  const { text } = entry.description;
  const index = text.indexOf(term);
  if (index === -1) {
    return NO_MATCH;
  }
  const wordIndex = findWordStart(text, term, index, entry.descriptionWordStarts, 0);
  const start = wordIndex === -1 ? index : wordIndex;
  const earliness = 1 - start / text.length;
  sink?.description.push([start, start + term.length]);
  return DESCRIPTION + (wordIndex === -1 ? 0 : 3) + earliness;
}

function matchPlainInFullName(entry: IndexedRepo, term: string, sink: RangeSink | null): number {
  const name = matchName(entry, term, sink);
  if (name !== NO_MATCH) {
    return name;
  }
  const owner = matchOwner(entry, term, sink);
  return owner !== NO_MATCH ? owner : matchFullSubsequence(entry, term, sink);
}

/** Quality from 1 for an exact segment down to 0.1 for a weak subsequence. */
function matchSegment(
  entry: IndexedRepo,
  segment: string,
  offset: number,
  part: string,
  ranges: HighlightRange[] | null,
): number {
  if (part === '') {
    return 1;
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
    ranges?.push([offset + start, offset + start + part.length]);
    return quality;
  }
  const { text } = entry.full;
  const end = offset + segment.length;
  const positions = ranges === null ? null : [];
  const quality = matchSubsequence(text, entry.fullWordStarts, part, offset, end, positions);
  if (quality === NOT_A_SUBSEQUENCE) {
    return NO_MATCH;
  }
  if (ranges !== null && positions !== null) {
    pushPositions(ranges, positions);
  }
  return 0.1 + 0.2 * quality;
}

/** `owner/name` style term: each side is matched against its own segment of the full name. */
function matchPath(entry: IndexedRepo, term: PathTerm, sink: RangeSink | null): number {
  // Buffered so that a failing name segment leaves no owner ranges behind.
  const ranges: HighlightRange[] | null = sink === null ? null : [];
  const owner = matchSegment(entry, entry.owner, 0, term.owner, ranges);
  const name =
    owner === NO_MATCH
      ? NO_MATCH
      : matchSegment(entry, entry.name, entry.nameStart, term.name, ranges);
  if (name !== NO_MATCH) {
    sink?.full.push(...(ranges ?? []));
    return OWNER + (EXACT_NAME - OWNER) * (0.4 * owner + 0.6 * name);
  }
  return matchPathParts(entry, term.parts, sink);
}

/** Fallback when the slash does not line up: every part must still match the full name. */
function matchPathParts(
  entry: IndexedRepo,
  parts: readonly string[],
  sink: RangeSink | null,
): number {
  // Buffered so that a failing later part leaves no ranges of earlier parts behind.
  const partSink: RangeSink | null = sink === null ? null : { full: [], description: [] };
  let total = 0;
  for (const part of parts) {
    const score = matchPlainInFullName(entry, part, partSink);
    if (score === NO_MATCH) {
      return NO_MATCH;
    }
    total += score;
  }
  sink?.full.push(...(partSink?.full ?? []));
  return PATH_PARTS + (PATH_PARTS_RANGE * total) / parts.length / EXACT_NAME;
}

function matchTerm(entry: IndexedRepo, term: Term, sink: RangeSink | null): number {
  const score =
    term.kind === 'plain'
      ? matchPlainInFullName(entry, term.text, sink)
      : matchPath(entry, term, sink);
  return score !== NO_MATCH ? score : matchDescription(entry, term.text, sink);
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

function toOriginalRanges(
  folded: FoldedText,
  ranges: readonly HighlightRange[],
): HighlightRange[] {
  return mergeRanges(ranges.map(([start, end]) => toOriginalRange(folded, start, end)));
}

function toResult(hit: Hit, terms: readonly Term[]): RepoSearchResult {
  const { entry } = hit;
  const sink: RangeSink = { full: [], description: [] };
  for (const term of terms) {
    matchTerm(entry, term, sink);
  }
  return {
    repo: entry.repo,
    score: hit.score,
    highlights: {
      fullName: toOriginalRanges(entry.full, sink.full),
      description: toOriginalRanges(entry.description, sink.description),
    },
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
    const top = createTopK(limit, compareHits);
    for (const entry of entries) {
      if (!accepts(entry)) {
        continue;
      }
      let score = 0;
      for (const term of terms) {
        const termScore = matchTerm(entry, term, null);
        if (termScore === NO_MATCH) {
          score = NO_MATCH;
          break;
        }
        score += termScore;
      }
      if (score !== NO_MATCH) {
        score += recencyBonus(entry.pushedAt, time) - penalty(entry.repo);
        top.offer({ entry, score });
      }
    }
    return top.items().map((hit) => toResult(hit, terms));
  }

  return { size: entries.length, search };
}
