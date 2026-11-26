export const TOKEN_STATUSES = [
  'unchecked',
  'valid',
  'pending_approval',
  'expired',
  'invalid',
  'wrong_user',
] as const;

export type TokenStatus = (typeof TOKEN_STATUSES)[number];

/**
 * Public description of a stored token. The secret itself never leaves the background
 * context, so this type deliberately has no field for it.
 */
export interface TokenInfo {
  readonly id: string;
  /** Resource owner (user or organization login) the token is scoped to. */
  readonly owner: string | null;
  readonly ownerSource: 'detected' | 'manual' | null;
  readonly status: TokenStatus;
  /** Login of the user the token belongs to. */
  readonly login: string | null;
  readonly expiresAt: string | null;
  readonly lastCheckedAt: string | null;
  /** Last characters of the token so the user can tell entries apart. */
  readonly hint: string;
}
