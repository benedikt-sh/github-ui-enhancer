import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertReadOnlyDocument } from '../github/graphql-guard.ts';
import { buildSearchDocument, ISSUE_FIELDS, PULL_REQUEST_FIELDS, searchAlias } from './queries.ts';

describe('buildSearchDocument', () => {
  it('aliases every search and passes terms as variables', () => {
    const { document, variables } = buildSearchDocument([
      { kind: 'pullRequest', query: 'is:pr author:@me "quoted"', first: 20 },
      { kind: 'issue', query: 'is:issue assignee:@me', first: 5 },
    ]);

    assert.equal(
      document,
      [
        'query BatchedSearch($q0: String!, $n0: Int!, $q1: String!, $n1: Int!) {',
        '  s0: search(query: $q0, type: ISSUE, first: $n0) { nodes { ...PullRequestFields } }',
        '  s1: search(query: $q1, type: ISSUE, first: $n1) { nodes { ...IssueFields } }',
        '}',
        PULL_REQUEST_FIELDS,
        ISSUE_FIELDS,
      ].join('\n'),
    );
    assert.deepEqual(variables, {
      q0: 'is:pr author:@me "quoted"',
      n0: 20,
      q1: 'is:issue assignee:@me',
      n1: 5,
    });
    assert.equal(document.includes('quoted'), false);
    assert.doesNotThrow(() => assertReadOnlyDocument(document));
  });

  it('appends each used fragment once and no unused one', () => {
    const { document } = buildSearchDocument([
      { kind: 'issue', query: 'a', first: 1 },
      { kind: 'issue', query: 'b', first: 1 },
    ]);

    assert.equal(document.split('fragment IssueFields').length, 2);
    assert.equal(document.includes('PullRequestFields'), false);
  });

  it('names aliases by position', () => {
    assert.equal(searchAlias(0), 's0');
    assert.equal(searchAlias(12), 's12');
  });
});
