export const PULL_REQUEST_FIELDS = `fragment PullRequestFields on PullRequest {
  __typename
  id
  number
  title
  url
  state
  isDraft
  reviewDecision
  createdAt
  updatedAt
  repository { name owner { login } }
  author { login avatarUrl url }
  labels(first: 20) { nodes { name color } }
  comments { totalCount }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export const ISSUE_FIELDS = `fragment IssueFields on Issue {
  __typename
  id
  number
  title
  url
  state
  stateReason
  createdAt
  updatedAt
  repository { name owner { login } }
  author { login avatarUrl url }
  assignees(first: 10) { nodes { login avatarUrl url } }
  labels(first: 20) { nodes { name color } }
  comments { totalCount }
}`;

export type SearchKind = 'pullRequest' | 'issue';

export interface SearchRequest {
  readonly kind: SearchKind;
  /** Complete search query including `is:pr` or `is:issue`. */
  readonly query: string;
  readonly first: number;
}

export interface SearchDocument {
  readonly document: string;
  readonly variables: Readonly<Record<string, string | number>>;
}

/** Response field holding the result of the request at `index`. */
export function searchAlias(index: number): string {
  return `s${index}`;
}

const FRAGMENTS: Readonly<Record<SearchKind, { name: string; definition: string }>> = {
  pullRequest: { name: 'PullRequestFields', definition: PULL_REQUEST_FIELDS },
  issue: { name: 'IssueFields', definition: ISSUE_FIELDS },
};

/**
 * Combines several searches into one document with one aliased `search` field each. Search
 * terms travel as variables, so user input never becomes part of the document. Only the
 * fragments in use are appended, because GraphQL rejects unused fragments.
 */
export function buildSearchDocument(requests: readonly SearchRequest[]): SearchDocument {
  const variables: Record<string, string | number> = {};
  const declarations: string[] = [];
  const fields: string[] = [];
  const kinds = new Set<SearchKind>();
  requests.forEach((request, index) => {
    const alias = searchAlias(index);
    const fragment = FRAGMENTS[request.kind];
    variables[`q${index}`] = request.query;
    variables[`n${index}`] = request.first;
    declarations.push(`$q${index}: String!`, `$n${index}: Int!`);
    fields.push(
      `  ${alias}: search(query: $q${index}, type: ISSUE, first: $n${index}) ` +
        `{ nodes { ...${fragment.name} } }`,
    );
    kinds.add(request.kind);
  });
  const fragments = [...kinds].map((kind) => FRAGMENTS[kind].definition);
  const document = [
    `query BatchedSearch(${declarations.join(', ')}) {`,
    ...fields,
    '}',
    ...fragments,
  ].join('\n');
  return { document, variables };
}
