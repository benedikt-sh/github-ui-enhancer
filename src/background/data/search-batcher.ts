import { ApiError, type ApiErrorInfo } from '../../shared/errors.ts';
import { isRecord } from '../../shared/guards.ts';
import type { GitHubClient, GraphQLFieldError, GraphQLResult } from '../github/types.ts';
import { buildSearchDocument, searchAlias, type SearchRequest } from './queries.ts';

/** Searches arriving within this many milliseconds share one GraphQL request per token. */
export const SEARCH_BATCH_WINDOW_MS = 15;
/** Keeps single documents well below GitHub's node limit even with 100 results per search. */
export const MAX_SEARCHES_PER_DOCUMENT = 10;

export interface SearchCredentials {
  readonly id: string;
  readonly secret: string;
}

export interface SearchOutcome {
  /** Raw search result nodes, callers map them. Entries may be null or foreign types. */
  readonly nodes: readonly unknown[];
  /** Field errors next to usable data, e.g. results hidden by SAML enforcement. */
  readonly errors: readonly ApiErrorInfo[];
}

export interface SearchBatcher {
  search(token: SearchCredentials, request: SearchRequest): Promise<SearchOutcome>;
}

export interface SearchBatcherOptions {
  readonly client: GitHubClient;
  /** Runs `flush` once the batch window is over. Tests pass a manual scheduler. */
  readonly schedule?: (flush: () => void) => void;
}

interface Pending {
  readonly request: SearchRequest;
  readonly resolve: (outcome: SearchOutcome) => void;
  readonly reject: (error: unknown) => void;
}

interface TokenBatch {
  readonly secret: string;
  readonly entries: Pending[];
}

function defaultSchedule(flush: () => void): void {
  setTimeout(flush, SEARCH_BATCH_WINDOW_MS);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * A match the token may not read comes back as a null node with a FORBIDDEN error below the
 * alias. It belongs to another owner, whose token (if any) delivers it, so it is not an error.
 */
function isForeignNode(error: GraphQLFieldError): boolean {
  return error.path.length > 1 && error.error.kind === 'forbidden';
}

function settle(entries: readonly Pending[], result: GraphQLResult): void {
  const unrelated = result.errors.filter((error) => error.path.length === 0);
  entries.forEach((entry, index) => {
    const alias = searchAlias(index);
    const own = result.errors.filter((error) => error.path[0] === alias);
    const field = result.data[alias];
    if (!isRecord(field)) {
      const cause: ApiErrorInfo = own[0]?.error ??
        unrelated[0]?.error ?? {
          kind: 'invalid_response',
          message: 'GitHub GraphQL search returned no result',
        };
      entry.reject(new ApiError(cause));
      return;
    }
    const nodes = field['nodes'];
    entry.resolve({
      nodes: Array.isArray(nodes) ? nodes : [],
      errors: own.filter((error) => !isForeignNode(error)).map((error) => error.error),
    });
  });
}

export function createSearchBatcher(options: SearchBatcherOptions): SearchBatcher {
  const { client } = options;
  const schedule = options.schedule ?? defaultSchedule;
  let pending = new Map<string, TokenBatch>();

  async function run(secret: string, entries: readonly Pending[]): Promise<void> {
    const { document, variables } = buildSearchDocument(
      entries.map((entry) => entry.request),
    );
    let result: GraphQLResult;
    try {
      result = await client.graphql(secret, document, variables);
    } catch (error) {
      for (const entry of entries) {
        entry.reject(error);
      }
      return;
    }
    settle(entries, result);
  }

  function flush(): void {
    const batches = pending;
    pending = new Map();
    for (const { secret, entries } of batches.values()) {
      for (const part of chunk(entries, MAX_SEARCHES_PER_DOCUMENT)) {
        void run(secret, part);
      }
    }
  }

  return {
    search(token, request) {
      return new Promise((resolve, reject) => {
        if (pending.size === 0) {
          schedule(flush);
        }
        let batch = pending.get(token.id);
        if (batch === undefined) {
          batch = { secret: token.secret, entries: [] };
          pending.set(token.id, batch);
        }
        batch.entries.push({ request, resolve, reject });
      });
    },
  };
}
