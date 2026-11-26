import { ApiError, type ApiErrorInfo } from '../../shared/errors.ts';
import { isRecord } from '../../shared/guards.ts';
import { mapGraphQLError, mapHttpError, redact } from './error-mapping.ts';
import { assertReadOnlyDocument } from './graphql-guard.ts';
import { parseNextLink, parseRateLimit, parseTokenExpiration } from './headers.ts';
import type {
  GitHubClient,
  GitHubClientDeps,
  GraphQLResult,
  QueryParams,
  RateLimitSnapshot,
  ResponseMeta,
  RestPages,
  RestResult,
} from './types.ts';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';
export const DEFAULT_MAX_PAGES = 10;

// Visible ASCII only. Anything else would make `Headers` throw an error that may quote the value.
const TOKEN_FORMAT = /^[\x21-\x7e]+$/;

interface Call {
  readonly method: 'GET' | 'POST';
  readonly url: URL;
  readonly body?: string;
  readonly etag?: string;
  readonly signal?: AbortSignal | undefined;
  /** Bucket assumed if GitHub omits `x-ratelimit-resource`. */
  readonly resource: string;
}

interface Received {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON body, null if empty. */
  readonly body: unknown;
  readonly meta: ResponseMeta;
}

function invalidRequest(message: string): ApiError {
  return new ApiError({ kind: 'invalid_request', message });
}

function buildUrl(path: string, query: QueryParams = {}): URL {
  const url = path.startsWith('/') ? URL.parse(path, GITHUB_API_ORIGIN) : null;
  // Checking the origin after parsing also catches tricks like "//host" or "/\host".
  if (url === null || url.origin !== GITHUB_API_ORIGIN) {
    throw invalidRequest('Path must be relative to the GitHub API root');
  }
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }
  return url;
}

function nextPageUrl(headers: Headers): URL | null {
  const link = parseNextLink(headers);
  if (link === null) {
    return null;
  }
  const url = URL.parse(link);
  // Following a foreign link would send the token to another host.
  if (url?.origin !== GITHUB_API_ORIGIN) {
    throw new ApiError({
      kind: 'invalid_response',
      message: 'Pagination link does not point to the GitHub API',
    });
  }
  return url;
}

function rethrowIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUsableData(data: unknown, errorCount: number): data is Record<string, unknown> {
  if (!isRecord(data)) {
    return false;
  }
  // A result consisting only of nulls next to errors carries no information.
  return errorCount === 0 || Object.values(data).some((value) => value !== null);
}

function isStale(previous: RateLimitSnapshot | undefined, next: RateLimitSnapshot): boolean {
  // Responses of parallel requests can arrive out of order within the same window.
  return (
    previous !== undefined &&
    previous.resetAt === next.resetAt &&
    previous.remaining < next.remaining
  );
}

export function createGitHubClient(deps: GitHubClientDeps): GitHubClient {
  // Called unbound on purpose: browsers throw "Illegal invocation" for `deps.fetch(...)`.
  const fetchImpl = deps.fetch;
  const now = deps.now ?? Date.now;
  const rateLimits = new Map<string, RateLimitSnapshot>();

  function fail(token: string, info: ApiErrorInfo): ApiError {
    return new ApiError(redact(info, token));
  }

  function recordRateLimit(snapshot: RateLimitSnapshot | null): void {
    if (snapshot !== null && !isStale(rateLimits.get(snapshot.resource), snapshot)) {
      rateLimits.set(snapshot.resource, snapshot);
    }
  }

  async function send(token: string, call: Call): Promise<Received> {
    if (!TOKEN_FORMAT.test(token)) {
      throw invalidRequest('Token is empty or contains invalid characters');
    }
    call.signal?.throwIfAborted();
    const request = `${call.method} ${call.url.pathname}`;
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    });
    if (call.etag !== undefined) {
      headers.set('If-None-Match', call.etag);
    }
    if (call.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(call.url, {
        method: call.method,
        headers,
        body: call.body ?? null,
        signal: call.signal ?? null,
      });
      text = response.status === 304 ? '' : await response.text();
    } catch (error) {
      rethrowIfAborted(call.signal);
      throw fail(token, {
        kind: 'network',
        message: `GitHub ${request} failed: ${errorText(error)}`,
      });
    }

    const meta: ResponseMeta = {
      rateLimit: parseRateLimit(response.headers, call.resource),
      tokenExpiresAt: parseTokenExpiration(response.headers),
    };
    recordRateLimit(meta.rateLimit);

    if (response.status === 304) {
      if (call.etag === undefined) {
        throw fail(token, {
          kind: 'invalid_response',
          message: `GitHub ${request} returned 304 to an unconditional request`,
          status: 304,
        });
      }
      return { status: 304, headers: response.headers, body: null, meta };
    }

    let body: unknown = null;
    let parseError: unknown = null;
    try {
      body = text.trim() === '' ? null : JSON.parse(text);
    } catch (error) {
      parseError = error;
    }

    // Error bodies are often HTML from a proxy, so the status decides before the parse result.
    if (!response.ok) {
      const info = mapHttpError({
        status: response.status,
        headers: response.headers,
        body,
        request,
        nowMillis: now(),
      });
      throw fail(token, info);
    }
    if (parseError !== null) {
      throw fail(token, {
        kind: 'invalid_response',
        message: `GitHub ${request} returned invalid JSON: ${errorText(parseError)}`,
        status: response.status,
      });
    }
    return { status: response.status, headers: response.headers, body, meta };
  }

  return {
    async restGet(token, path, options = {}): Promise<RestResult> {
      const { etag, signal } = options;
      const received = await send(token, {
        method: 'GET',
        url: buildUrl(path, options.query),
        ...(etag === undefined ? {} : { etag }),
        signal,
        resource: 'core',
      });
      const responseEtag = received.headers.get('etag');
      if (etag !== undefined && received.status === 304) {
        // GitHub repeats the ETag on 304, the fallback only guards against proxies dropping it.
        return { kind: 'not_modified', etag: responseEtag ?? etag, meta: received.meta };
      }
      return { kind: 'ok', data: received.body, etag: responseEtag, meta: received.meta };
    },

    async restGetPages(token, path, options = {}): Promise<RestPages> {
      const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
      if (!Number.isInteger(maxPages) || maxPages < 1) {
        throw invalidRequest('maxPages must be a positive integer');
      }
      const pages: unknown[] = [];
      let url = buildUrl(path, options.query);
      for (;;) {
        const received = await send(token, {
          method: 'GET',
          url,
          signal: options.signal,
          resource: 'core',
        });
        pages.push(received.body);
        const next = nextPageUrl(received.headers);
        if (next === null || pages.length >= maxPages) {
          return { pages, truncated: next !== null, meta: received.meta };
        }
        url = next;
      }
    },

    async graphql(token, query, variables = {}, options = {}): Promise<GraphQLResult> {
      assertReadOnlyDocument(query);
      let body: string;
      try {
        body = JSON.stringify({ query, variables });
      } catch (error) {
        throw invalidRequest(`GraphQL variables are not serializable: ${errorText(error)}`);
      }
      const received = await send(token, {
        method: 'POST',
        url: new URL('/graphql', GITHUB_API_ORIGIN),
        body,
        signal: options.signal,
        resource: 'graphql',
      });
      if (!isRecord(received.body)) {
        throw new ApiError({
          kind: 'invalid_response',
          message: 'GraphQL response is not an object',
        });
      }
      const rawErrors = received.body['errors'];
      const errors = (Array.isArray(rawErrors) ? rawErrors : []).map((error) => {
        const mapped = mapGraphQLError(error, received.headers, now());
        return { path: mapped.path, error: redact(mapped.error, token) };
      });
      const data = received.body['data'];
      if (!isUsableData(data, errors.length)) {
        throw new ApiError(
          errors[0]?.error ?? { kind: 'invalid_response', message: 'GraphQL response has no data' },
        );
      }
      return { data, errors, meta: received.meta };
    },

    rateLimit(resource) {
      return rateLimits.get(resource) ?? null;
    },
  };
}
