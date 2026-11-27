import type { TokenInfo } from '../../shared/tokens.ts';
import { h } from '../../ui/dom.ts';
import { button, notice } from '../../ui/forms.ts';

export const EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenProblems {
  readonly severity: 'danger' | 'warning';
  readonly title: string;
  readonly messages: readonly string[];
}

function tokenName(token: TokenInfo): string {
  return token.owner ? `The token for ${token.owner}` : `The token ending in ${token.hint}`;
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function expiresIn(token: TokenInfo, now: number): number | null {
  const expiresAt = token.expiresAt === null ? Number.NaN : Date.parse(token.expiresAt);
  return Number.isNaN(expiresAt) ? null : expiresAt - now;
}

interface TokenProblem {
  readonly message: string;
  /** False for warnings about tokens that still work, like an expiry date coming up. */
  readonly blocking: boolean;
}

function problemOf(token: TokenInfo, pageLogin: string | null, now: number): TokenProblem | null {
  const name = tokenName(token);
  const remaining = expiresIn(token, now);
  if (token.status === 'expired' || (remaining !== null && remaining <= 0)) {
    return { message: `${name} has expired.`, blocking: true };
  }
  if (token.status === 'invalid') {
    return { message: `${name} is invalid or was revoked.`, blocking: true };
  }
  if (token.status === 'pending_approval') {
    return { message: `${name} is waiting for approval by an organization owner.`, blocking: true };
  }
  const foreignLogin =
    token.login !== null && pageLogin !== null && !sameLogin(token.login, pageLogin);
  if (foreignLogin) {
    return { message: `${name} belongs to ${token.login}, not to ${pageLogin}.`, blocking: true };
  }
  if (token.status === 'wrong_user') {
    return { message: `${name} belongs to another GitHub account.`, blocking: true };
  }
  if (remaining !== null && remaining <= EXPIRY_WARNING_DAYS * DAY_MS) {
    const days = Math.ceil(remaining / DAY_MS);
    return { message: `${name} expires in ${days} day${days === 1 ? '' : 's'}.`, blocking: false };
  }
  return null;
}

/**
 * `unchecked` tokens count as usable: they are validated in the background shortly after being
 * added, and warning about them in the meantime would only confuse.
 */
export function findTokenProblems(
  tokens: readonly TokenInfo[],
  pageLogin: string | null,
  now: number,
): TokenProblems | null {
  if (tokens.length === 0) {
    return {
      severity: 'danger',
      title: 'No access token configured',
      messages: [
        'Add a fine-grained personal access token with read access in the settings to fill ' +
          'the dashboard.',
      ],
    };
  }
  const problems = tokens.map((token) => ({ token, problem: problemOf(token, pageLogin, now) }));
  const messages = problems.flatMap(({ problem }) => (problem === null ? [] : [problem.message]));
  const usable = problems.some(
    ({ token, problem }) =>
      problem?.blocking !== true && (token.status === 'valid' || token.status === 'unchecked'),
  );
  if (!usable) {
    return { severity: 'danger', title: 'No working access token', messages };
  }
  if (messages.length === 0) {
    return null;
  }
  return { severity: 'warning', title: 'Check your access tokens', messages };
}

export function tokenNotice(problems: TokenProblems, openOptions: () => void): HTMLDivElement {
  const [first] = problems.messages;
  return notice({
    variant: problems.severity,
    title: problems.title,
    message:
      problems.messages.length === 1
        ? first
        : h(
            'ul',
            { className: 'ghx-host-notice-list' },
            problems.messages.map((message) => h('li', null, message)),
          ),
    actions: [
      button({ label: 'Open settings', icon: 'gear', size: 'small', onClick: openOptions }),
    ],
  });
}
