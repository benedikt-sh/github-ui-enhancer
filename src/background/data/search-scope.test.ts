import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ActiveToken } from '../tokens/token-registry.ts';
import { scopeSearchQuery } from './search-scope.ts';

const PERSONAL: ActiveToken = { id: 'p', secret: 's1', owner: 'alice', login: 'Alice' };
const ACME: ActiveToken = { id: 'a', secret: 's2', owner: 'acme', login: 'alice' };
const ACME_AGAIN: ActiveToken = { id: 'a2', secret: 's3', owner: 'ACME', login: 'alice' };
const GLOBEX: ActiveToken = { id: 'g', secret: 's4', owner: 'globex', login: 'alice' };
const NO_OWNER: ActiveToken = { id: 'n', secret: 's5', owner: null, login: 'alice' };
const NO_LOGIN: ActiveToken = { id: 'l', secret: 's6', owner: 'initech', login: null };

const QUERY = 'is:pr is:open author:@me';

describe('scopeSearchQuery', () => {
  it('limits org tokens to their org', () => {
    assert.equal(scopeSearchQuery(QUERY, ACME, [PERSONAL, ACME]), `${QUERY} org:acme`);
  });

  it('excludes orgs with their own token from the personal search, once per org', () => {
    const tokens = [PERSONAL, ACME, ACME_AGAIN, GLOBEX, NO_OWNER, NO_LOGIN];

    assert.equal(
      scopeSearchQuery(QUERY, PERSONAL, tokens),
      `${QUERY} -org:acme -org:globex -org:initech`,
    );
  });

  it('keeps the query of the personal token alone', () => {
    assert.equal(scopeSearchQuery(QUERY, PERSONAL, [PERSONAL]), QUERY);
  });

  it('leaves queries that already name repositories or owners alone', () => {
    for (const query of [`${QUERY} repo:acme/api`, `${QUERY} ORG:acme`, `user:alice ${QUERY}`]) {
      assert.equal(scopeSearchQuery(query, ACME, [PERSONAL, ACME]), query);
      assert.equal(scopeSearchQuery(query, PERSONAL, [PERSONAL, ACME]), query);
    }
    assert.equal(
      scopeSearchQuery(`${QUERY} -org:globex`, ACME, [PERSONAL, ACME]),
      `${QUERY} -org:globex org:acme`,
    );
  });

  it('leaves tokens without owner or login unscoped', () => {
    assert.equal(scopeSearchQuery(QUERY, NO_OWNER, [PERSONAL, NO_OWNER]), QUERY);
    assert.equal(scopeSearchQuery(QUERY, NO_LOGIN, [PERSONAL, NO_LOGIN]), QUERY);
  });
});
