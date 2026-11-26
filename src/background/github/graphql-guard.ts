import { ApiError } from '../../shared/errors.ts';

const WORD_CHAR = /[_0-9A-Za-z]/;
const CLOSING: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']' };
const WRITE_OPERATIONS = new Set(['mutation', 'subscription']);
const READ_DEFINITIONS = new Set(['query', 'fragment', '{']);

/**
 * Yields names, numbers and brackets of a GraphQL document. Comments and string literals are
 * skipped so their content can never be mistaken for an operation keyword. Other punctuators
 * are irrelevant for finding definition starts and are dropped.
 */
function* tokenize(source: string): Generator<string> {
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === '#') {
      index = skipComment(source, index + 1);
    } else if (source.startsWith('"""', index)) {
      index = skipBlockString(source, index + 3);
    } else if (char === '"') {
      index = skipString(source, index + 1);
    } else if (WORD_CHAR.test(char)) {
      const start = index;
      while (index < source.length && WORD_CHAR.test(source.charAt(index))) {
        index += 1;
      }
      yield source.slice(start, index);
    } else {
      if ('{}()[]'.includes(char)) {
        yield char;
      }
      index += 1;
    }
  }
}

function skipComment(source: string, index: number): number {
  let end = index;
  while (end < source.length && source.charAt(end) !== '\n' && source.charAt(end) !== '\r') {
    end += 1;
  }
  return end;
}

function skipString(source: string, index: number): number {
  let end = index;
  while (end < source.length) {
    const char = source.charAt(end);
    if (char === '\\') {
      end += 2;
    } else if (char === '"') {
      return end + 1;
    } else if (char === '\n' || char === '\r') {
      return end;
    } else {
      end += 1;
    }
  }
  return source.length;
}

function skipBlockString(source: string, index: number): number {
  let end = index;
  while (end < source.length) {
    if (source.startsWith('\\"""', end)) {
      end += 4;
    } else if (source.startsWith('"""', end)) {
      return end + 3;
    } else {
      end += 1;
    }
  }
  return source.length;
}

function invalid(message: string): ApiError {
  return new ApiError({ kind: 'invalid_request', message });
}

/**
 * Throws `blocked_write` if the document defines a mutation or subscription. Only definition
 * starts are inspected, so field names, arguments or variables called "mutation" stay allowed.
 * Anything that is not clearly a query or fragment is refused instead of guessed.
 */
export function assertReadOnlyDocument(document: string): void {
  const open: string[] = [];
  let atDefinitionStart = true;
  for (const token of tokenize(document)) {
    if (atDefinitionStart) {
      if (WRITE_OPERATIONS.has(token)) {
        throw new ApiError({
          kind: 'blocked_write',
          message: `GraphQL ${token} operations are not allowed, the client is read-only`,
        });
      }
      if (!READ_DEFINITIONS.has(token)) {
        throw invalid(`Unsupported GraphQL definition starting with "${token.slice(0, 40)}"`);
      }
      atDefinitionStart = false;
    }
    const closing = CLOSING[token];
    if (closing !== undefined) {
      open.push(closing);
    } else if (token === '}' || token === ')' || token === ']') {
      if (open.pop() !== token) {
        throw invalid('Unbalanced brackets in GraphQL document');
      }
      atDefinitionStart = open.length === 0 && token === '}';
    }
  }
}
