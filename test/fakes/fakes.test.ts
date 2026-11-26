import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installDom } from '../dom.ts';
import { createFetchFake } from './fetch.ts';
import { createFakeMessaging } from './runtime.ts';
import { createFakeStorageArea } from './storage.ts';
import { createFakeWidgetData, dataResult } from './widget-data.ts';

describe('fetch fake', () => {
  it('serves json, records requests and prefers once routes', async () => {
    const fake = createFetchFake()
      .on('https://api.github.com/user', { body: { login: 'octocat' } })
      .once('https://api.github.com/user', { status: 401, body: { message: 'Bad credentials' } });

    const first = await fake.fetch('https://api.github.com/user', {
      headers: { authorization: 'Bearer x' },
    });
    const second = await fake.fetch('https://api.github.com/user?per_page=1');

    assert.equal(first.status, 401);
    assert.equal(second.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await second.json(), { login: 'octocat' });
    assert.equal(fake.requests[0]?.headers.get('authorization'), 'Bearer x');
  });

  it('supports regex and function matchers, text bodies and empty 304s', async () => {
    const fake = createFetchFake()
      .on(/\/graphql$/, (request) => ({ body: `echo ${request.body}` }))
      .on((request) => request.url.endsWith('/etag'), { status: 304, body: { ignored: true } });

    const echo = await fake.fetch('https://api.github.com/graphql', { method: 'POST', body: 'q' });
    const notModified = await fake.fetch('https://api.github.com/etag');

    assert.equal(await echo.text(), 'echo q');
    assert.equal(notModified.status, 304);
    assert.equal(await notModified.text(), '');
  });

  it('fails on unknown requests and simulates network errors', async () => {
    const fake = createFetchFake().failNetwork('https://api.github.com/down');

    await assert.rejects(fake.fetch('https://api.github.com/down'), TypeError);
    await assert.rejects(fake.fetch('https://api.github.com/else'), /Unexpected request: GET/);
  });
});

describe('storage fake', () => {
  it('clones values and can fail', async () => {
    const area = createFakeStorageArea({ a: { n: 1 } });
    const read = await area.get(['a', 'missing']);
    (read['a'] as { n: number }).n = 2;

    assert.deepEqual(area.snapshot(), { a: { n: 1 } });
    await area.remove(['a']);
    assert.deepEqual(area.snapshot(), {});
    area.failWith(new Error('nope'));
    await assert.rejects(area.get('a'), /nope/);
  });
});

describe('messaging fake', () => {
  it('resolves the first response only and supports removing listeners', async () => {
    const messaging = createFakeMessaging();
    const first = (_m: unknown, _s: unknown, respond: (r: never) => void) => {
      respond('first' as never);
      respond('second' as never);
      return false;
    };
    messaging.addListener(first);

    assert.equal(await messaging.content.sendMessage('x'), 'first');
    messaging.removeListener(first);
    await assert.rejects(messaging.content.sendMessage('x'), /Receiving end does not exist/);
  });
});

describe('widget data fake', () => {
  it('returns empty results by default and records calls', async () => {
    const data = createFakeWidgetData().handle('searchIssues', async (query) =>
      dataResult([], { stale: query === 'old' }),
    );

    assert.deepEqual(await data.repoIndex(), dataResult([]));
    assert.equal((await data.searchIssues('old')).stale, true);
    assert.deepEqual(data.callsTo('searchIssues'), [['old']]);
    assert.equal(data.calls.length, 2);
  });
});

describe('dom helper', () => {
  it('installs and restores globals', async () => {
    const originalEvent = globalThis.Event;
    const dom = installDom('https://github.com/feed');

    assert.equal(location.pathname, '/feed');
    const element = document.createElement('div');
    element.addEventListener('ping', () => {
      element.textContent = 'pong';
    });
    element.dispatchEvent(new CustomEvent('ping'));
    assert.equal(element.textContent, 'pong');

    await dom.cleanup();
    assert.equal(globalThis.Event, originalEvent);
    assert.equal('document' in globalThis, false);
  });
});
