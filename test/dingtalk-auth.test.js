import assert from 'node:assert/strict';
import test from 'node:test';

import { createTokenProvider } from '../src/dingtalk-auth.js';
import { ToolError } from '../src/dingtalk-tool-error.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('getToken sends the DingTalk access token request contract', async () => {
  let request;
  const provider = createTokenProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ accessToken: 'access-token', expireIn: 7200 });
    },
  });

  assert.equal(await provider.getToken(), 'access-token');
  assert.equal(request.url, 'https://api.dingtalk.com/v1.0/oauth2/accessToken');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    appKey: 'client-id',
    appSecret: 'client-secret',
  });
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('getToken reuses a cached token before its safe expiry', async () => {
  let calls = 0;
  let time = 1_000;
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    now: () => time,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ accessToken: `token-${calls}`, expireIn: 120 });
    },
  });

  assert.equal(await provider.getToken(), 'token-1');
  time += 59_000;
  assert.equal(await provider.getToken(), 'token-1');
  assert.equal(calls, 1);
});

test('getToken refreshes after expiry minus safety skew', async () => {
  let calls = 0;
  let time = 1_000;
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    now: () => time,
    fetchImpl: async () => jsonResponse({ accessToken: `token-${++calls}`, expireIn: 120 }),
  });

  assert.equal(await provider.getToken(), 'token-1');
  time += 60_000;
  assert.equal(await provider.getToken(), 'token-2');
});

test('short-lived tokens remain cacheable with bounded safety skew', async () => {
  let calls = 0;
  let time = 0;
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    now: () => time,
    fetchImpl: async () => jsonResponse({ accessToken: `token-${++calls}`, expireIn: 30 }),
  });

  assert.equal(await provider.getToken(), 'token-1');
  assert.equal(await provider.getToken(), 'token-1');
  time = 15_000;
  assert.equal(await provider.getToken(), 'token-2');
});

test('forceRefresh bypasses a valid cached token', async () => {
  let calls = 0;
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ accessToken: `token-${++calls}`, expireIn: 7200 }),
  });

  assert.equal(await provider.getToken(), 'token-1');
  assert.equal(await provider.getToken({ forceRefresh: true }), 'token-2');
  assert.equal(calls, 2);
});

test('concurrent cache misses share one token request', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => {
      calls += 1;
      await pending;
      return jsonResponse({ accessToken: 'shared-token', expireIn: 7200 });
    },
  });

  const first = provider.getToken();
  const second = provider.getToken();
  release();

  assert.deepEqual(await Promise.all([first, second]), ['shared-token', 'shared-token']);
  assert.equal(calls, 1);
});

test('timeout and abort failures become UPSTREAM_TIMEOUT', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('secret abort detail', 'AbortError')));
    }),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.doesNotMatch(error.message, /secret abort detail/);
    return true;
  });
});

test('timeout also bounds reading the token response body', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    timeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => new Promise(() => {}),
    }),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    return true;
  });
});

test('HTTP credential rejection becomes AUTH_FAILED', async () => {
  for (const status of [401, 403]) {
    const provider = createTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: async () => jsonResponse({ message: 'bad secret' }, status),
    });

    await assert.rejects(provider.getToken(), (error) => {
      assert.equal(error.code, 'AUTH_FAILED');
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /bad secret/);
      return true;
    });
  }
});

test('DingTalk auth error response becomes AUTH_FAILED', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ code: 'InvalidAuthentication', message: 'secret rejected' }, 400),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'AUTH_FAILED');
    assert.equal(error.status, 400);
    assert.doesNotMatch(error.message, /secret rejected/);
    return true;
  });
});

test('DingTalk InvalidClient response becomes AUTH_FAILED', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ code: 'InvalidClient' }, 400),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'AUTH_FAILED');
    assert.equal(error.status, 400);
    return true;
  });
});

test('DingTalk invalid app credentials response becomes AUTH_FAILED', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({
      code: 'InvalidParameter',
      message: 'appKey or appSecret is not valid',
    }, 400),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'AUTH_FAILED');
    assert.doesNotMatch(error.message, /appKey|appSecret/i);
    return true;
  });
});

test('non-auth HTTP failure becomes UPSTREAM_ERROR', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ message: 'database detail' }, 503),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /database detail/);
    return true;
  });
});

test('non-auth DingTalk errcode becomes UPSTREAM_ERROR', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ errcode: 500, errmsg: 'internal failure' }, 503),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.equal(error.status, 503);
    return true;
  });
});

test('non-auth error code containing client becomes UPSTREAM_ERROR', async () => {
  const provider = createTokenProvider({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => jsonResponse({ code: 'ClientRateLimited', message: 'slow down' }, 429),
  });

  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.equal(error.status, 429);
    return true;
  });
});

test('network failure and malformed success body become safe UPSTREAM_ERROR errors', async () => {
  const cases = [
    async () => { throw new Error('network contains client-secret'); },
    async () => new Response('not-json: client-secret', { status: 200 }),
    async () => jsonResponse({ accessToken: '', expireIn: 7200 }),
    async () => jsonResponse({ accessToken: 'leaked-token', expireIn: 0 }),
  ];

  for (const fetchImpl of cases) {
    const provider = createTokenProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchImpl,
    });

    await assert.rejects(provider.getToken(), (error) => {
      assert.equal(error.code, 'UPSTREAM_ERROR');
      const serialized = JSON.stringify(error);
      for (const secret of ['client-id', 'client-secret', 'leaked-token', 'not-json']) {
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.doesNotMatch(serialized, new RegExp(secret));
      }
      return true;
    });
  }
});
