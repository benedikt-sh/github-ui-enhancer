import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFakeStorageArea, type FakeStorageArea } from '../../../test/fakes/storage.ts';
import { ApiError, type ApiErrorKind } from '../../shared/errors.ts';
import { createAreaStore } from '../../shared/storage.ts';
import { createTokenRegistry, type TokenRegistry } from './token-registry.ts';
import type { TokenIdentity, TokenProbe } from './token-probe.ts';

const ALICE = 'github_pat_alice0000';
const ALICE_ORG = 'github_pat_aliceorg1111';
const BOB = 'github_pat_bob2222';

type Answer<T> = T | Error | Promise<T>;

interface FakeProbe extends TokenProbe {
  readonly identities: Map<string, Answer<TokenIdentity>>;
  readonly owners: Map<string, Answer<string[]>>;
  readonly calls: string[];
}

async function resolve<T>(answer: Answer<T> | undefined, secret: string): Promise<T> {
  if (answer === undefined) {
    throw new Error(`unexpected secret ${secret}`);
  }
  if (answer instanceof Error) {
    throw answer;
  }
  return answer;
}

function createFakeProbe(): FakeProbe {
  const identities = new Map<string, Answer<TokenIdentity>>([
    [ALICE, { login: 'alice', expiresAt: '2027-01-01T00:00:00Z' }],
    [ALICE_ORG, { login: 'Alice', expiresAt: null }],
    [BOB, { login: 'bob', expiresAt: null }],
  ]);
  const owners = new Map<string, Answer<string[]>>([
    [ALICE, ['alice', 'alice']],
    [ALICE_ORG, ['Acme', 'acme']],
    [BOB, ['bob']],
  ]);
  const calls: string[] = [];
  return {
    identities,
    owners,
    calls,
    inspect(secret) {
      calls.push(`inspect ${secret}`);
      return resolve(identities.get(secret), secret);
    },
    repositoryOwners(secret) {
      calls.push(`owners ${secret}`);
      return resolve(owners.get(secret), secret);
    },
  };
}

function apiError(kind: ApiErrorKind): ApiError {
  return new ApiError({ kind, message: kind });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    settle = resolvePromise;
  });
  return { promise, resolve: settle };
}

interface Setup {
  readonly registry: TokenRegistry;
  readonly probe: FakeProbe;
  readonly area: FakeStorageArea;
  readonly clock: { now: Date };
}

function setup(initial: Record<string, unknown> = {}): Setup {
  const area = createFakeStorageArea(initial);
  const probe = createFakeProbe();
  const clock = { now: new Date('2026-11-26T12:00:00Z') };
  let counter = 0;
  const registry = createTokenRegistry({
    store: createAreaStore(area),
    probe,
    now: () => clock.now,
    createId: () => `id-${++counter}`,
  });
  return { registry, probe, area, clock };
}

async function assertApiError(promise: Promise<unknown>, kind: ApiErrorKind): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.info.kind, kind);
    return true;
  });
}

describe('createTokenRegistry add', () => {
  it('stores, validates and detects the owner of a new token', async () => {
    const { registry, area } = setup();

    const info = await registry.add(`  ${ALICE}  `);

    assert.deepEqual(info, {
      id: 'id-1',
      owner: 'alice',
      ownerSource: 'detected',
      status: 'valid',
      login: 'alice',
      expiresAt: '2027-01-01T00:00:00Z',
      lastCheckedAt: '2026-11-26T12:00:00.000Z',
      hint: '0000',
    });
    assert.deepEqual(await registry.list(), [info]);
    assert.deepEqual(area.snapshot(), {
      'ghx:tokens': {
        version: 1,
        entries: [
          {
            id: 'id-1',
            secret: ALICE,
            owner: 'alice',
            ownerSource: 'detected',
            status: 'valid',
            login: 'alice',
            expiresAt: '2027-01-01T00:00:00Z',
            lastCheckedAt: '2026-11-26T12:00:00.000Z',
          },
        ],
      },
    });
  });

  it('rejects classic tokens without storing or probing them', async () => {
    const { registry, probe, area } = setup();

    const classic = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

    await assertApiError(registry.add(classic), 'invalid_request');

    assert.deepEqual(area.snapshot(), {});
    assert.deepEqual(probe.calls, []);
  });

  it('rejects duplicates', async () => {
    const { registry } = setup();
    await registry.add(ALICE);

    await assertApiError(registry.add(`${ALICE}\n`), 'invalid_request');
    assert.equal((await registry.list()).length, 1);
  });

  it('keeps a manual owner and skips detection', async () => {
    const { registry, probe } = setup();

    const info = await registry.add(ALICE, ' my-org ');

    assert.equal(info.owner, 'my-org');
    assert.equal(info.ownerSource, 'manual');
    assert.deepEqual(probe.calls, [`inspect ${ALICE}`]);
  });

  it('treats a blank owner as not set', async () => {
    const { registry } = setup();

    const info = await registry.add(ALICE, '');

    assert.equal(info.ownerSource, 'detected');
  });

  it('rejects invalid owners', async () => {
    const { registry, area } = setup();

    await assertApiError(registry.add(ALICE, 'not/valid'), 'invalid_request');
    assert.deepEqual(area.snapshot(), {});
  });

  it('keeps the token unchecked when validation fails transiently', async () => {
    const { registry, probe } = setup();
    probe.identities.set(ALICE, apiError('network'));

    await assertApiError(registry.add(ALICE), 'network');

    const [info] = await registry.list();
    assert.equal(info?.status, 'unchecked');
    assert.equal(info?.lastCheckedAt, null);
  });

  it('uses random ids and the system clock by default', async () => {
    const registry = createTokenRegistry({
      store: createAreaStore(createFakeStorageArea()),
      probe: createFakeProbe(),
    });

    const info = await registry.add(ALICE);

    assert.match(info.id, /^[0-9a-f-]{36}$/);
    assert.ok(info.lastCheckedAt !== null && !Number.isNaN(Date.parse(info.lastCheckedAt)));
  });
});

describe('createTokenRegistry owner detection', () => {
  it('detects one owner regardless of case', async () => {
    const { registry } = setup();

    const info = await registry.add(ALICE_ORG);

    assert.equal(info.owner, 'Acme');
    assert.equal(info.ownerSource, 'detected');
  });

  it('leaves the owner unset when the token sees no repositories', async () => {
    const { registry, probe } = setup();
    probe.owners.set(ALICE, []);

    const info = await registry.add(ALICE);

    assert.equal(info.owner, null);
    assert.equal(info.ownerSource, null);
    assert.equal(info.status, 'valid');
  });

  it('leaves the owner unset when repositories belong to several owners', async () => {
    const { registry, probe } = setup();
    probe.owners.set(ALICE, ['alice', 'acme']);

    const info = await registry.add(ALICE);

    assert.equal(info.owner, null);
  });

  it('updates a detected owner on the next validation', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE);
    probe.owners.set(ALICE, ['other']);

    const info = await registry.validate(id);

    assert.equal(info.owner, 'other');
  });
});

describe('createTokenRegistry setOwner', () => {
  it('sets a manual owner that validation never overwrites', async () => {
    const { registry } = setup();
    const { id } = await registry.add(ALICE);

    const manual = await registry.setOwner(id, 'acme');
    const validated = await registry.validate(id);

    assert.equal(manual.owner, 'acme');
    assert.equal(manual.ownerSource, 'manual');
    assert.equal(validated.owner, 'acme');
    assert.equal(validated.ownerSource, 'manual');
  });

  it('returns to detection when the owner is cleared', async () => {
    const { registry } = setup();
    const { id } = await registry.add(ALICE, 'acme');

    const info = await registry.setOwner(id, null);

    assert.equal(info.owner, 'alice');
    assert.equal(info.ownerSource, 'detected');
  });

  it('keeps the cleared owner when detection fails transiently', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE, 'acme');
    probe.owners.set(ALICE, apiError('rate_limited'));

    await assertApiError(registry.setOwner(id, null), 'rate_limited');

    const [info] = await registry.list();
    assert.equal(info?.owner, null);
    assert.equal(info?.ownerSource, null);
  });

  it('rejects invalid owners and unknown ids', async () => {
    const { registry } = setup();
    const { id } = await registry.add(ALICE);

    await assertApiError(registry.setOwner(id, 'no spaces'), 'invalid_request');
    await assertApiError(registry.setOwner('missing', 'acme'), 'invalid_request');
    await assertApiError(registry.setOwner('missing', null), 'invalid_request');
  });
});

describe('createTokenRegistry validate', () => {
  it('marks rejected tokens as invalid', async () => {
    const { registry, probe } = setup();
    probe.identities.set(ALICE, apiError('unauthorized'));

    const info = await registry.add(ALICE);

    assert.equal(info.status, 'invalid');
    assert.equal(info.lastCheckedAt, '2026-11-26T12:00:00.000Z');
  });

  it('marks rejected tokens past their expiration as expired', async () => {
    const { registry, probe, clock } = setup();
    const { id } = await registry.add(ALICE);
    clock.now = new Date('2027-02-01T00:00:00Z');
    probe.identities.set(ALICE, apiError('unauthorized'));

    const info = await registry.validate(id);

    assert.equal(info.status, 'expired');
    assert.equal(info.login, 'alice');
  });

  it('marks tokens awaiting organization approval as pending', async () => {
    const { registry, probe } = setup();
    probe.owners.set(ALICE, apiError('pending_approval'));

    const info = await registry.add(ALICE);

    assert.equal(info.status, 'pending_approval');
  });

  it('keeps the previous state and rethrows transient errors', async () => {
    const { registry, probe, clock } = setup();
    const before = await registry.add(ALICE);
    clock.now = new Date('2026-11-27T00:00:00Z');

    for (const kind of ['network', 'rate_limited', 'internal', 'forbidden'] as const) {
      probe.identities.set(ALICE, apiError(kind));
      await assertApiError(registry.validate(before.id), kind);
    }

    assert.deepEqual(await registry.list(), [before]);
  });

  it('wraps unexpected errors into an internal ApiError', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE);
    probe.identities.set(ALICE, new TypeError('Failed to fetch'));

    await assert.rejects(registry.validate(id), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.deepEqual(error.info, { kind: 'internal', message: 'Failed to fetch' });
      return true;
    });
  });

  it('turns a previously invalid token valid again', async () => {
    const { registry, probe } = setup();
    probe.identities.set(ALICE, apiError('unauthorized'));
    const { id } = await registry.add(ALICE);
    probe.identities.set(ALICE, { login: 'alice', expiresAt: null });

    const info = await registry.validate(id);

    assert.equal(info.status, 'valid');
    assert.equal(info.expiresAt, null);
  });

  it('rejects unknown ids', async () => {
    const { registry } = setup();

    await assertApiError(registry.validate('missing'), 'invalid_request');
  });

  it('rejects when the token is removed during the check', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE);
    const identity = deferred<TokenIdentity>();
    probe.identities.set(ALICE, identity.promise);

    const validation = registry.validate(id);
    await registry.remove(id);
    identity.resolve({ login: 'alice', expiresAt: null });

    await assertApiError(validation, 'invalid_request');
    assert.deepEqual(await registry.list(), []);
  });

  it('keeps an owner set manually while the check was running', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE);
    const identity = deferred<TokenIdentity>();
    probe.identities.set(ALICE, identity.promise);

    const validation = registry.validate(id);
    await registry.setOwner(id, 'acme');
    identity.resolve({ login: 'alice', expiresAt: null });

    const info = await validation;
    assert.equal(info.owner, 'acme');
    assert.equal(info.ownerSource, 'manual');
  });
});

describe('createTokenRegistry user consistency', () => {
  it('accepts tokens of the same user regardless of case', async () => {
    const { registry } = setup();
    await registry.add(ALICE);

    const info = await registry.add(ALICE_ORG);

    assert.equal(info.status, 'valid');
  });

  it('marks tokens of another user as wrong_user', async () => {
    const { registry } = setup();
    await registry.add(ALICE);

    const info = await registry.add(BOB);

    assert.equal(info.status, 'wrong_user');
    assert.equal(info.login, 'bob');
  });

  it('ignores tokens that are not valid when comparing users', async () => {
    const { registry, probe } = setup();
    probe.identities.set(ALICE, apiError('unauthorized'));
    await registry.add(ALICE);

    const info = await registry.add(BOB);

    assert.equal(info.status, 'valid');
  });

  it('compares against other tokens only', async () => {
    const { registry, probe } = setup();
    const { id } = await registry.add(ALICE);
    probe.identities.set(ALICE, { login: 'renamed', expiresAt: null });

    const info = await registry.validate(id);

    assert.equal(info.status, 'valid');
    assert.equal(info.login, 'renamed');
  });
});

describe('createTokenRegistry remove', () => {
  it('removes a token', async () => {
    const { registry } = setup();
    const { id } = await registry.add(ALICE);
    await registry.add(BOB);

    await registry.remove(id);

    assert.deepEqual(
      (await registry.list()).map((info) => info.hint),
      ['2222'],
    );
  });

  it('rejects unknown ids', async () => {
    const { registry } = setup();

    await assertApiError(registry.remove('missing'), 'invalid_request');
  });
});

describe('createTokenRegistry data layer access', () => {
  async function populated(): Promise<Setup & { ids: string[] }> {
    const context = setup();
    const { registry, probe } = context;
    probe.identities.set(BOB, apiError('unauthorized'));
    const ids = [
      (await registry.add(ALICE)).id,
      (await registry.add(ALICE_ORG)).id,
      (await registry.add(BOB)).id,
    ];
    return { ...context, ids };
  }

  it('lists only usable tokens with their secrets', async () => {
    const { registry } = await populated();

    assert.deepEqual(await registry.activeTokens(), [
      { id: 'id-1', secret: ALICE, owner: 'alice' },
      { id: 'id-2', secret: ALICE_ORG, owner: 'Acme' },
    ]);
  });

  it('includes usable tokens without an owner', async () => {
    const { registry, probe } = setup();
    probe.owners.set(ALICE, []);
    await registry.add(ALICE);

    assert.deepEqual(await registry.activeTokens(), [{ id: 'id-1', secret: ALICE, owner: null }]);
    assert.equal(await registry.tokenForOwner('alice'), null);
  });

  it('treats tokens past their expiration as expired without a new check', async () => {
    const { registry, clock } = await populated();
    clock.now = new Date('2027-01-01T00:00:00Z');

    assert.deepEqual(
      (await registry.activeTokens()).map((token) => token.id),
      ['id-2'],
    );
    assert.equal((await registry.list())[0]?.status, 'expired');
    assert.equal(await registry.tokenForOwner('alice'), null);
  });

  it('finds the token for an owner regardless of case', async () => {
    const { registry } = await populated();

    assert.deepEqual(await registry.tokenForOwner('ACME'), {
      id: 'id-2',
      secret: ALICE_ORG,
      owner: 'Acme',
    });
  });

  it('returns null for owners without a usable token', async () => {
    const { registry } = await populated();

    assert.equal(await registry.tokenForOwner('bob'), null);
    assert.equal(await registry.tokenForOwner('nobody'), null);
  });
});

describe('createTokenRegistry reportFailure', () => {
  it('marks tokens as invalid or expired on 401', async () => {
    const { registry, clock } = setup();
    const { id } = await registry.add(ALICE);
    clock.now = new Date('2026-12-01T00:00:00Z');

    const invalid = await registry.reportFailure(id, { kind: 'unauthorized', message: '401' });
    clock.now = new Date('2027-06-01T00:00:00Z');
    const expired = await registry.reportFailure(id, { kind: 'unauthorized', message: '401' });

    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.lastCheckedAt, '2026-12-01T00:00:00.000Z');
    assert.equal(expired.status, 'expired');
    assert.deepEqual(await registry.activeTokens(), []);
  });

  it('marks tokens as pending approval', async () => {
    const { registry } = setup();
    const { id } = await registry.add(ALICE);

    const info = await registry.reportFailure(id, { kind: 'pending_approval', message: 'x' });

    assert.equal(info.status, 'pending_approval');
  });

  it('ignores errors that say nothing about the token', async () => {
    const { registry, area } = setup();
    const before = await registry.add(ALICE);
    const snapshot = area.snapshot();

    const info = await registry.reportFailure(before.id, { kind: 'network', message: 'offline' });

    assert.deepEqual(info, before);
    assert.deepEqual(area.snapshot(), snapshot);
  });

  it('rejects unknown ids', async () => {
    const { registry } = setup();

    await assertApiError(
      registry.reportFailure('missing', { kind: 'unauthorized', message: '401' }),
      'invalid_request',
    );
  });
});

describe('createTokenRegistry storage', () => {
  it('reads tokens stored earlier and drops broken entries', async () => {
    const { registry } = setup({
      'ghx:tokens': {
        version: 1,
        entries: [
          { id: 'old', secret: ALICE, status: 'valid', login: 'alice' },
          { id: 'broken' },
        ],
      },
    });

    const infos = await registry.list();

    assert.deepEqual(
      infos.map((info) => [info.id, info.status]),
      [['old', 'valid']],
    );
  });

  it('starts empty when the stored value is unusable', async () => {
    const { registry } = setup({ 'ghx:tokens': 'garbage' });

    assert.deepEqual(await registry.list(), []);
    assert.deepEqual(await registry.activeTokens(), []);
  });

  it('does not lose concurrent writes', async () => {
    const { registry } = setup();

    const infos = await Promise.all([
      registry.add(ALICE),
      registry.add(ALICE_ORG),
      registry.add(BOB, 'bob'),
    ]);

    assert.equal(new Set(infos.map((info) => info.id)).size, 3);
    assert.equal((await registry.list()).length, 3);
  });

  it('rejects concurrent duplicates', async () => {
    const { registry } = setup();

    const results = await Promise.allSettled([registry.add(ALICE), registry.add(ALICE)]);

    assert.deepEqual(
      results.map((result) => result.status),
      ['fulfilled', 'rejected'],
    );
    assert.equal((await registry.list()).length, 1);
  });

  it('propagates storage failures and keeps working afterwards', async () => {
    const { registry, area } = setup();
    area.failWith(new Error('QUOTA_BYTES quota exceeded'));

    await assert.rejects(registry.add(ALICE), /quota exceeded/);
    area.failWith(null);

    assert.equal((await registry.add(ALICE)).status, 'valid');
  });
});
