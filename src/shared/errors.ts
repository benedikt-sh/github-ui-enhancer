import { isOneOf, isRecord, isString } from './guards.ts';

export const API_ERROR_KINDS = [
  'unauthorized',
  'forbidden',
  'sso_required',
  'pending_approval',
  'rate_limited',
  'not_found',
  'network',
  'no_tokens',
  'no_token_for_owner',
  'blocked_write',
  'invalid_response',
  'invalid_request',
  'not_allowed',
  'internal',
] as const;

export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

/**
 * Serializable error description. It crosses the messaging boundary, so it must never contain
 * a token or request headers.
 */
export interface ApiErrorInfo {
  readonly kind: ApiErrorKind;
  readonly message: string;
  /** Resource owner whose token or permissions caused the error. */
  readonly owner?: string;
  /** Link the user can follow to fix the problem, e.g. the SSO authorization URL. */
  readonly actionUrl?: string;
  /** Seconds until a retry makes sense, for `rate_limited`. */
  readonly retryAfter?: number;
  readonly status?: number;
}

export class ApiError extends Error {
  readonly info: ApiErrorInfo;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
    this.info = info;
  }
}

export function isApiErrorInfo(value: unknown): value is ApiErrorInfo {
  return (
    isRecord(value) &&
    isOneOf(API_ERROR_KINDS, value['kind']) &&
    isString(value['message'])
  );
}

export function toApiErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiError) {
    return error.info;
  }
  if (isApiErrorInfo(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'internal', message };
}
