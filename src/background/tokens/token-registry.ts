import { ApiError, type ApiErrorInfo, toApiErrorInfo } from '../../shared/errors.ts';
import { createId as createRandomId } from '../../shared/layout.ts';
import { sameOwner } from '../../shared/repo.ts';
import { type KeyValueStore, STORAGE_KEYS } from '../../shared/storage.ts';
import type { TokenInfo, TokenStatus } from '../../shared/tokens.ts';
import { createSerialQueue } from './serial-queue.ts';
import {
  effectiveStatus,
  isPast,
  parseStoredTokens,
  serializeTokens,
  type StoredToken,
  toTokenInfo,
} from './stored-token.ts';
import { normalizeOwner, normalizeSecret } from './token-input.ts';
import type { TokenIdentity, TokenProbe } from './token-probe.ts';

/** A usable token for the data layer. Only the background context may see this type. */
export interface ActiveToken {
  readonly id: string;
  readonly secret: string;
  /** Null when the owner could not be detected and was not set manually. */
  readonly owner: string | null;
}

export interface TokenRegistry {
  list(): Promise<TokenInfo[]>;
  /**
   * Stores the token and validates it right away. If validation fails for a transient reason,
   * the token stays stored as `unchecked` and the error is rethrown.
   */
  add(secret: string, owner?: string | null): Promise<TokenInfo>;
  /**
   * Checks the token against GitHub. Invalid, expired or pending tokens resolve with the new
   * status. Transient failures (network, rate limit) keep the previous status and reject.
   */
  validate(id: string): Promise<TokenInfo>;
  /** A manual owner is never replaced by detection. `null` clears it and detects again. */
  setOwner(id: string, owner: string | null): Promise<TokenInfo>;
  remove(id: string): Promise<void>;
  activeTokens(): Promise<ActiveToken[]>;
  /** Case-insensitive, considers only usable tokens. */
  tokenForOwner(owner: string): Promise<ActiveToken | null>;
  /** Lets runtime errors (401, pending approval) update the status without a full check. */
  reportFailure(id: string, error: ApiErrorInfo): Promise<TokenInfo>;
}

export interface TokenRegistryOptions {
  /** Must be backed by `storage.local`, never `storage.sync`. */
  readonly store: KeyValueStore;
  readonly probe: TokenProbe;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

type Mutation<T> = (entries: readonly StoredToken[]) => {
  readonly entries: readonly StoredToken[];
  readonly result: T;
};

type ProbeOutcome =
  | { readonly kind: 'identified'; readonly identity: TokenIdentity; readonly owner: string | null }
  | { readonly kind: 'rejected'; readonly status: TokenStatus };

function unknownToken(): ApiError {
  return new ApiError({ kind: 'invalid_request', message: 'The token does not exist.' });
}

function findEntry(entries: readonly StoredToken[], id: string): StoredToken {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw unknownToken();
  }
  return entry;
}

function replaceEntry(entries: readonly StoredToken[], next: StoredToken): StoredToken[] {
  return entries.map((entry) => (entry.id === next.id ? next : entry));
}

/** Null means the failure says nothing about the token itself, e.g. a network error. */
function statusForFailure(error: ApiErrorInfo, entry: StoredToken, now: Date): TokenStatus | null {
  switch (error.kind) {
    case 'unauthorized':
      return isPast(entry.expiresAt, now) ? 'expired' : 'invalid';
    case 'pending_approval':
      return 'pending_approval';
    default:
      return null;
  }
}

function singleOwner(owners: readonly string[]): string | null {
  const [first] = owners;
  return first !== undefined && owners.every((owner) => sameOwner(owner, first)) ? first : null;
}

/** All tokens must belong to the same GitHub user as the tokens already known to be valid. */
function identityStatus(entries: readonly StoredToken[], id: string, login: string): TokenStatus {
  const otherLogins = entries
    .filter((entry) => entry.id !== id && entry.status === 'valid')
    .map((entry) => entry.login)
    .filter((other) => other !== null);
  return otherLogins.length === 0 || otherLogins.some((other) => sameOwner(other, login))
    ? 'valid'
    : 'wrong_user';
}

export function createTokenRegistry(options: TokenRegistryOptions): TokenRegistry {
  const { store, probe } = options;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? createRandomId;
  const serialize = createSerialQueue();

  const load = async (): Promise<StoredToken[]> =>
    parseStoredTokens(await store.get(STORAGE_KEYS.tokens));

  const read = <T>(select: (entries: readonly StoredToken[]) => T): Promise<T> =>
    serialize(async () => select(await load()));

  const mutate = <T>(change: Mutation<T>): Promise<T> =>
    serialize(async () => {
      const current = await load();
      const { entries, result } = change(current);
      if (entries !== current) {
        await store.set(STORAGE_KEYS.tokens, serializeTokens(entries));
      }
      return result;
    });

  const updateEntry = (
    id: string,
    change: (entry: StoredToken, entries: readonly StoredToken[]) => StoredToken,
  ): Promise<TokenInfo> =>
    mutate((entries) => {
      const entry = findEntry(entries, id);
      const next = change(entry, entries);
      return {
        entries: next === entry ? entries : replaceEntry(entries, next),
        result: toTokenInfo(next, now()),
      };
    });

  const toActive = (entry: StoredToken): ActiveToken => ({
    id: entry.id,
    secret: entry.secret,
    owner: entry.owner,
  });

  const usable = (entries: readonly StoredToken[]): StoredToken[] => {
    const at = now();
    return entries.filter((entry) => effectiveStatus(entry, at) === 'valid');
  };

  const runProbe = async (entry: StoredToken): Promise<ProbeOutcome> => {
    try {
      const identity = await probe.inspect(entry.secret);
      const owner =
        entry.ownerSource === 'manual'
          ? null
          : singleOwner(await probe.repositoryOwners(entry.secret));
      return { kind: 'identified', identity, owner };
    } catch (error) {
      const info = toApiErrorInfo(error);
      const status = statusForFailure(info, entry, now());
      if (status === null) {
        throw error instanceof ApiError ? error : new ApiError(info);
      }
      return { kind: 'rejected', status };
    }
  };

  const validate = async (id: string): Promise<TokenInfo> => {
    const outcome = await runProbe(await read((entries) => findEntry(entries, id)));
    const checkedAt = now().toISOString();
    // The probe ran outside the queue, so the result is applied to the current entry, which may
    // have been changed (e.g. a manual owner set) in the meantime.
    return updateEntry(id, (entry, entries) => {
      if (outcome.kind === 'rejected') {
        return { ...entry, status: outcome.status, lastCheckedAt: checkedAt };
      }
      const { login, expiresAt } = outcome.identity;
      const detected = entry.ownerSource !== 'manual';
      return {
        ...entry,
        status: identityStatus(entries, id, login),
        login,
        expiresAt,
        lastCheckedAt: checkedAt,
        owner: detected ? outcome.owner : entry.owner,
        ownerSource: detected ? (outcome.owner === null ? null : 'detected') : 'manual',
      };
    });
  };

  return {
    list: () => read((entries) => entries.map((entry) => toTokenInfo(entry, now()))),

    async add(input, ownerInput) {
      const secret = normalizeSecret(input);
      const owner = normalizeOwner(ownerInput);
      const id = await mutate((entries) => {
        if (entries.some((entry) => entry.secret === secret)) {
          throw new ApiError({
            kind: 'invalid_request',
            message: 'This token has already been added.',
          });
        }
        const entry: StoredToken = {
          id: createId(),
          secret,
          owner,
          ownerSource: owner === null ? null : 'manual',
          status: 'unchecked',
          login: null,
          expiresAt: null,
          lastCheckedAt: null,
        };
        return { entries: [...entries, entry], result: entry.id };
      });
      return validate(id);
    },

    validate,

    async setOwner(id, input) {
      const owner = normalizeOwner(input);
      if (owner !== null) {
        return updateEntry(id, (entry) => ({ ...entry, owner, ownerSource: 'manual' }));
      }
      await updateEntry(id, (entry) => ({ ...entry, owner: null, ownerSource: null }));
      return validate(id);
    },

    remove: (id) =>
      mutate((entries) => {
        findEntry(entries, id);
        return { entries: entries.filter((entry) => entry.id !== id), result: undefined };
      }),

    activeTokens: () => read((entries) => usable(entries).map(toActive)),

    tokenForOwner: (owner) =>
      read((entries) => {
        const match = usable(entries).find(
          (entry) => entry.owner !== null && sameOwner(entry.owner, owner),
        );
        return match === undefined ? null : toActive(match);
      }),

    reportFailure: (id, error) =>
      updateEntry(id, (entry) => {
        const at = now();
        const status = statusForFailure(error, entry, at);
        return status === null ? entry : { ...entry, status, lastCheckedAt: at.toISOString() };
      }),
  };
}
