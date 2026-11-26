import type { ApiErrorInfo } from '../../shared/errors.ts';
import { isRecord, isString } from '../../shared/guards.ts';
import { parseSsoRequirement, retryAfterSeconds } from './headers.ts';
import type { GraphQLFieldError } from './types.ts';

// GitHub recommends waiting at least a minute when a limit is hit without timing headers.
const DEFAULT_RETRY_SECONDS = 60;
const MAX_DETAIL_LENGTH = 300;

const RATE_LIMIT_MESSAGE = /rate limit/i;
const MISSING_PERMISSION_MESSAGE =
  /resource not accessible by (personal access token|integration)/i;
const SAML_MESSAGE = /saml enforcement/i;
// Heuristic: GitHub does not document the response for a fine-grained token that still waits
// for organization approval. Must be verified against a real pending token.
// Only applied to 401/403 and FORBIDDEN, whose messages do not echo user supplied names.
const PENDING_APPROVAL_MESSAGE =
  /\b(pending|awaiting)\b[^.]*\bapprov|\bnot (yet )?(been )?approved\b/i;

export interface HttpErrorInput {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON body or null if the body was empty or not JSON. */
  readonly body: unknown;
  /** Method and path for the message, e.g. `GET /user/repos`. Must not contain secrets. */
  readonly request: string;
  readonly nowMillis: number;
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}...` : text;
}

function githubMessage(body: unknown): string | null {
  return isRecord(body) && isString(body['message']) ? truncate(body['message']) : null;
}

function rateLimited(headers: Headers, nowMillis: number, message: string): ApiErrorInfo {
  const retryAfter = retryAfterSeconds(headers, nowMillis) ?? DEFAULT_RETRY_SECONDS;
  return { kind: 'rate_limited', message, retryAfter };
}

function ssoRequired(headers: Headers, message: string): ApiErrorInfo {
  const url = parseSsoRequirement(headers)?.url;
  return url === undefined
    ? { kind: 'sso_required', message }
    : { kind: 'sso_required', message, actionUrl: url };
}

function isRateLimitResponse(status: number, headers: Headers, detail: string): boolean {
  if (status === 429) {
    return true;
  }
  return (
    status === 403 &&
    (headers.has('retry-after') ||
      headers.get('x-ratelimit-remaining')?.trim() === '0' ||
      RATE_LIMIT_MESSAGE.test(detail))
  );
}

export function mapHttpError(input: HttpErrorInput): ApiErrorInfo {
  const { status, headers, request } = input;
  const detail = githubMessage(input.body) ?? 'no message';
  const message = `GitHub ${request} failed with ${status}: ${detail}`;

  if (status === 403 && parseSsoRequirement(headers) !== null) {
    return { ...ssoRequired(headers, message), status };
  }
  if (isRateLimitResponse(status, headers, detail)) {
    return { ...rateLimited(headers, input.nowMillis, message), status };
  }
  if ((status === 401 || status === 403) && PENDING_APPROVAL_MESSAGE.test(detail)) {
    return { kind: 'pending_approval', message, status };
  }
  if (status === 401) {
    return { kind: 'unauthorized', message, status };
  }
  if (status === 403 && MISSING_PERMISSION_MESSAGE.test(detail)) {
    return { kind: 'forbidden', message: `${message} (token lacks a permission)`, status };
  }
  if (status === 403) {
    return { kind: 'forbidden', message, status };
  }
  if (status === 404 || status === 410) {
    return { kind: 'not_found', message, status };
  }
  if (status === 400 || status === 409 || status === 422) {
    return { kind: 'invalid_request', message, status };
  }
  return { kind: 'internal', message, status };
}

function errorPath(value: unknown): (string | number)[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number',
  );
}

function graphQLErrorInfo(error: unknown, headers: Headers, nowMillis: number): ApiErrorInfo {
  const record = isRecord(error) ? error : {};
  const type = isString(record['type']) ? record['type'] : null;
  const detail = isString(record['message']) ? truncate(record['message']) : 'no message';
  const message = `GitHub GraphQL error${type === null ? '' : ` ${type}`}: ${detail}`;

  if (SAML_MESSAGE.test(detail)) {
    return ssoRequired(headers, message);
  }
  if (type === 'RATE_LIMITED' || RATE_LIMIT_MESSAGE.test(detail)) {
    return rateLimited(headers, nowMillis, message);
  }
  if (type === 'FORBIDDEN' && PENDING_APPROVAL_MESSAGE.test(detail)) {
    return { kind: 'pending_approval', message };
  }
  switch (type) {
    case 'FORBIDDEN':
      return { kind: 'forbidden', message };
    case 'NOT_FOUND':
      return { kind: 'not_found', message };
    case 'UNAUTHORIZED':
      return { kind: 'unauthorized', message };
    // Errors without a type are query validation errors such as unknown fields.
    case null:
      return { kind: 'invalid_request', message };
    default:
      return { kind: 'internal', message };
  }
}

export function mapGraphQLError(
  error: unknown,
  headers: Headers,
  nowMillis: number,
): GraphQLFieldError {
  return {
    path: errorPath(isRecord(error) ? error['path'] : undefined),
    error: graphQLErrorInfo(error, headers, nowMillis),
  };
}

/** Removes the token from a message in case GitHub or a runtime error ever echoes it. */
export function redact(info: ApiErrorInfo, token: string): ApiErrorInfo {
  if (token === '' || !info.message.includes(token)) {
    return info;
  }
  return { ...info, message: info.message.split(token).join('[redacted]') };
}
