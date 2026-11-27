import type { TokenInfo, TokenStatus } from '../shared/tokens.ts';
import { formatShortDate, toTimestamp } from '../ui/time.ts';

export type StatusTone = 'neutral' | 'success' | 'attention' | 'danger';

export interface StatusDescription {
  readonly label: string;
  readonly explanation: string;
  readonly tone: StatusTone;
}

const STATUS_DESCRIPTIONS: Record<TokenStatus, StatusDescription> = {
  unchecked: {
    label: 'Not checked',
    explanation: 'The token has not been checked against GitHub yet.',
    tone: 'neutral',
  },
  valid: {
    label: 'Valid',
    explanation: 'The token works and is used to read data.',
    tone: 'success',
  },
  pending_approval: {
    label: 'Pending approval',
    explanation: 'Waiting for an organization owner to approve the token.',
    tone: 'attention',
  },
  expired: {
    label: 'Expired',
    explanation: 'The token has expired. Create a new token and remove this one.',
    tone: 'danger',
  },
  invalid: {
    label: 'Invalid',
    explanation: 'GitHub rejected the token. It may have been revoked or regenerated.',
    tone: 'danger',
  },
  wrong_user: {
    label: 'Wrong account',
    explanation: 'The token belongs to another GitHub account than the other tokens.',
    tone: 'danger',
  },
};

export function describeStatus(status: TokenStatus): StatusDescription {
  return STATUS_DESCRIPTIONS[status];
}

const DAY = 24 * 60 * 60 * 1000;
export const EXPIRY_WARNING_DAYS = 14;

export interface ExpiryDescription {
  readonly text: string;
  readonly tone: 'muted' | 'attention' | 'danger';
  /** Null without a usable expiry date. */
  readonly at: Date | null;
}

export function describeExpiry(
  token: Pick<TokenInfo, 'expiresAt' | 'lastCheckedAt'>,
  now: Date,
): ExpiryDescription {
  if (token.expiresAt === null) {
    // Fine-grained tokens may be created without an expiry date, which only a check can tell.
    return token.lastCheckedAt === null
      ? { text: 'Expiry unknown', tone: 'muted', at: null }
      : { text: 'Does not expire', tone: 'muted', at: null };
  }
  const expiresAt = toTimestamp(token.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return { text: 'Expiry unknown', tone: 'muted', at: null };
  }
  const at = new Date(expiresAt);
  const date = formatShortDate(expiresAt, now);
  const remaining = expiresAt - now.getTime();
  if (remaining <= 0) {
    return { text: `Expired on ${date}`, tone: 'danger', at };
  }
  const days = Math.ceil(remaining / DAY);
  if (days <= 1) {
    return { text: `Expires within a day (${date})`, tone: 'attention', at };
  }
  if (days <= EXPIRY_WARNING_DAYS) {
    return { text: `Expires in ${days} days (${date})`, tone: 'attention', at };
  }
  return { text: `Expires on ${date}`, tone: 'muted', at };
}
