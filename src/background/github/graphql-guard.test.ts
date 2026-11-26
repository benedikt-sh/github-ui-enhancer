import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError } from '../../shared/errors.ts';
import { assertReadOnlyDocument } from './graphql-guard.ts';

function rejectsWith(document: string, kind: string): void {
  assert.throws(
    () => assertReadOnlyDocument(document),
    (error: unknown) => error instanceof ApiError && error.info.kind === kind,
  );
}

describe('assertReadOnlyDocument', () => {
  it('allows queries, shorthand queries and fragments', () => {
    assertReadOnlyDocument('{ viewer { login } }');
    assertReadOnlyDocument('query { viewer { login } }');
    assertReadOnlyDocument(`
      query Search($q: String!, $first: Int = 10, $filter: In = { a: [1, 2] }) {
        search(query: $q, first: $first) { ...Fields }
      }
      fragment Fields on SearchResultItemConnection { issueCount }
    `);
    assertReadOnlyDocument('');
  });

  it('allows the word mutation in strings, comments, names and arguments', () => {
    assertReadOnlyDocument(`
      # mutation { deleteRepository }
      query mutation($mutation: String = "mutation { x }") {
        mutation: search(query: "is:pr mutation", type: ISSUE) { issueCount }
        a: search(query: "say \\"hi\\" \\\\", type: ISSUE) { issueCount }
        b: repository(name: """block "quoted" \\""" mutation { x }""") { id }
        subscription { id }
      }
    `);
  });

  it('blocks mutations and subscriptions', () => {
    rejectsWith('mutation { addStar(input: {}) { clientMutationId } }', 'blocked_write');
    rejectsWith('subscription { x }', 'blocked_write');
  });

  it('blocks a mutation after a query', () => {
    rejectsWith('query { a } mutation M { b }', 'blocked_write');
    rejectsWith('query ($x: In = { a: 1 }) { a } # c\nmutation { b }', 'blocked_write');
  });

  it('still sees a mutation behind an unterminated string line', () => {
    rejectsWith('query { a(x: "open\n) } mutation { b }', 'blocked_write');
  });

  it('refuses unknown definitions and unbalanced brackets', () => {
    rejectsWith('Mutation { a }', 'invalid_request');
    rejectsWith('type Query { a: Int }', 'invalid_request');
    rejectsWith('query { a } } mutation { b }', 'invalid_request');
    rejectsWith('query { a ) mutation { b }', 'invalid_request');
    rejectsWith(']', 'invalid_request');
  });

  it('ignores unterminated strings and block strings at the end', () => {
    assertReadOnlyDocument('query { a(x: "open');
    assertReadOnlyDocument('query { a(x: """open');
  });
});
