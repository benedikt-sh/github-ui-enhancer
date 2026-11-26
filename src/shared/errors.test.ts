import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, isApiErrorInfo, toApiErrorInfo } from './errors.ts';

describe('ApiError', () => {
  it('carries the info and uses its message', () => {
    const error = new ApiError({ kind: 'not_found', message: 'gone', status: 404 });

    assert.equal(error.message, 'gone');
    assert.equal(error.name, 'ApiError');
    assert.deepEqual(error.info, { kind: 'not_found', message: 'gone', status: 404 });
  });
});

describe('isApiErrorInfo', () => {
  it('accepts known kinds with a message', () => {
    assert.equal(isApiErrorInfo({ kind: 'sso_required', message: 'x' }), true);
  });

  it('rejects unknown kinds, missing messages and non-objects', () => {
    assert.equal(isApiErrorInfo({ kind: 'weird', message: 'x' }), false);
    assert.equal(isApiErrorInfo({ kind: 'network' }), false);
    assert.equal(isApiErrorInfo('network'), false);
  });
});

describe('toApiErrorInfo', () => {
  it('unwraps ApiError', () => {
    const info = { kind: 'rate_limited', message: 'slow down', retryAfter: 30 } as const;
    assert.equal(toApiErrorInfo(new ApiError(info)), info);
  });

  it('passes through serialized infos', () => {
    const info = { kind: 'network', message: 'offline' };
    assert.equal(toApiErrorInfo(info), info);
  });

  it('maps other errors and values to internal', () => {
    assert.deepEqual(toApiErrorInfo(new TypeError('boom')), { kind: 'internal', message: 'boom' });
    assert.deepEqual(toApiErrorInfo('text'), { kind: 'internal', message: 'text' });
  });
});
