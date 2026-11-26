import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isNonEmptyString, isOneOf, isRecord, isString } from './guards.ts';

describe('guards', () => {
  it('isRecord accepts plain objects only', () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord(null), false);
    assert.equal(isRecord('x'), false);
  });

  it('isString and isNonEmptyString', () => {
    assert.equal(isString(''), true);
    assert.equal(isString(1), false);
    assert.equal(isNonEmptyString(''), false);
    assert.equal(isNonEmptyString('a'), true);
    assert.equal(isNonEmptyString(undefined), false);
  });

  it('isOneOf checks membership for strings', () => {
    const values = ['a', 'b'] as const;
    assert.equal(isOneOf(values, 'a'), true);
    assert.equal(isOneOf(values, 'c'), false);
    assert.equal(isOneOf(values, 1), false);
  });
});
