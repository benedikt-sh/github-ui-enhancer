import type { ApiErrorInfo } from '../../shared/errors.ts';

/**
 * State of one rate limit bucket. GitHub reports the bucket in `x-ratelimit-resource`, e.g.
 * `core`, `search` or `graphql`.
 */
export interface RateLimitSnapshot {
  readonly resource: string;
  readonly limit: number;
  readonly remaining: number;
  readonly used: number;
  /** ISO 8601 time at which the bucket refills. */
  readonly resetAt: string;
}

export interface ResponseMeta {
  readonly rateLimit: RateLimitSnapshot | null;
  /** ISO 8601 expiration of the token that made the request, null if GitHub sent none. */
  readonly tokenExpiresAt: string | null;
}

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

export interface RestGetOptions {
  readonly query?: QueryParams;
  /** ETag of a cached response, sent as `If-None-Match`. */
  readonly etag?: string;
  readonly signal?: AbortSignal;
}

export interface RestOk {
  readonly kind: 'ok';
  /** Parsed JSON body, null for an empty body. Callers validate the shape. */
  readonly data: unknown;
  readonly etag: string | null;
  readonly meta: ResponseMeta;
}

export interface RestNotModified {
  readonly kind: 'not_modified';
  readonly etag: string;
  readonly meta: ResponseMeta;
}

export type RestResult = RestOk | RestNotModified;

export interface RestPagesOptions {
  readonly query?: QueryParams;
  /** Upper bound of requests, protects the rate limit. Defaults to 10. */
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
}

export interface RestPages {
  /** Parsed JSON body of every fetched page, in order. */
  readonly pages: readonly unknown[];
  /** True if more pages exist than `maxPages` allowed to fetch. */
  readonly truncated: boolean;
  /** Metadata of the last fetched page. */
  readonly meta: ResponseMeta;
}

export type GraphQLVariables = Readonly<Record<string, unknown>>;

export interface GraphQLOptions {
  readonly signal?: AbortSignal;
}

export interface GraphQLFieldError {
  /** Response path of the failed field, empty for errors not tied to a field. */
  readonly path: readonly (string | number)[];
  readonly error: ApiErrorInfo;
}

export interface GraphQLResult {
  readonly data: Readonly<Record<string, unknown>>;
  /** Errors next to usable data, e.g. fields hidden by SAML enforcement of one organization. */
  readonly errors: readonly GraphQLFieldError[];
  readonly meta: ResponseMeta;
}

/**
 * Read-only access to the GitHub API. Every call takes the token explicitly, the client keeps
 * no token state. There is deliberately no method for non-GET REST requests.
 */
export interface GitHubClient {
  restGet(token: string, path: string, options?: RestGetOptions): Promise<RestResult>;
  restGetPages(token: string, path: string, options?: RestPagesOptions): Promise<RestPages>;
  graphql(
    token: string,
    query: string,
    variables?: GraphQLVariables,
    options?: GraphQLOptions,
  ): Promise<GraphQLResult>;
  /**
   * Latest snapshot seen for a bucket, across all tokens, because GitHub counts the limits per
   * user and not per token.
   */
  rateLimit(resource: string): RateLimitSnapshot | null;
}

export interface GitHubClientDeps {
  readonly fetch: typeof fetch;
  /** Current time in milliseconds, defaults to `Date.now`. */
  readonly now?: () => number;
}
