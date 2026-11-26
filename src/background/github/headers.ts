import type { RateLimitSnapshot } from './types.ts';

// At most 12 digits keeps epoch seconds inside the range `Date` can represent.
const INTEGER = /^\d{1,12}$/;
const EXPIRATION = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/;
const LINK = /<([^>]*)>([^<]*)/g;
const LINK_REL = /\brel\s*=\s*"?([^";,]*)/i;
const SSO_URL = /\burl=(\S+)/;

function readInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name)?.trim();
  return value !== undefined && INTEGER.test(value) ? Number(value) : null;
}

export function parseRateLimit(
  headers: Headers,
  fallbackResource: string,
): RateLimitSnapshot | null {
  const limit = readInteger(headers, 'x-ratelimit-limit');
  const remaining = readInteger(headers, 'x-ratelimit-remaining');
  const reset = readInteger(headers, 'x-ratelimit-reset');
  if (limit === null || remaining === null || reset === null) {
    return null;
  }
  return {
    resource: headers.get('x-ratelimit-resource')?.trim() || fallbackResource,
    limit,
    remaining,
    used: readInteger(headers, 'x-ratelimit-used') ?? limit - remaining,
    resetAt: new Date(reset * 1000).toISOString(),
  };
}

/** Reads `github-authentication-token-expiration`, e.g. `2027-01-01 00:00:00 UTC`. */
export function parseTokenExpiration(headers: Headers): string | null {
  const value = headers.get('github-authentication-token-expiration')?.trim() ?? '';
  const match = EXPIRATION.exec(value);
  if (match === null) {
    return null;
  }
  const [, date = '', time = '', zone = ''] = match;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const millis = Date.parse(`${date}T${time}${offset}`);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

/** Target of `rel="next"` in the `Link` header. */
export function parseNextLink(headers: Headers): string | null {
  const header = headers.get('link');
  if (header === null) {
    return null;
  }
  for (const [, target = '', params = ''] of header.matchAll(LINK)) {
    const rel = LINK_REL.exec(params)?.[1] ?? '';
    if (rel.split(/\s+/).includes('next')) {
      return target;
    }
  }
  return null;
}

export interface SsoRequirement {
  /** Authorization URL, only set if it is a valid https URL. */
  readonly url: string | undefined;
}

/**
 * Reads `X-GitHub-SSO: required; url=...`. The `partial-results; organizations=...` variant
 * on successful list responses is not a requirement and yields null.
 */
export function parseSsoRequirement(headers: Headers): SsoRequirement | null {
  const header = headers.get('x-github-sso');
  if (header === null || header.split(';')[0]?.trim().toLowerCase() !== 'required') {
    return null;
  }
  const candidate = SSO_URL.exec(header)?.[1];
  const url = candidate === undefined ? null : URL.parse(candidate);
  return { url: url?.protocol === 'https:' ? url.href : undefined };
}

/**
 * Seconds to wait as GitHub recommends: `retry-after` first, then the reset time if the
 * bucket is empty. Null if neither applies.
 */
export function retryAfterSeconds(headers: Headers, nowMillis: number): number | null {
  const retryAfter = readInteger(headers, 'retry-after');
  if (retryAfter !== null) {
    return retryAfter;
  }
  const reset = readInteger(headers, 'x-ratelimit-reset');
  if (readInteger(headers, 'x-ratelimit-remaining') === 0 && reset !== null) {
    return Math.max(0, Math.ceil(reset - nowMillis / 1000));
  }
  return null;
}
