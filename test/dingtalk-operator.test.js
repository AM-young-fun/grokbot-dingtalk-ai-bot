import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatorIdProvider } from '../src/dingtalk-operator.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('resolves userId to unionId once and caches it', async () => {
  const calls = [];
  const provider = createOperatorIdProvider({
    operatorUserId: 'user / one',
    tokenProvider: { async getToken() { return 'app-token'; } },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ unionId: 'union-one' });
    },
  });

  assert.equal(await provider.getOperatorId(), 'union-one');
  assert.equal(await provider.getOperatorId(), 'union-one');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.dingtalk.com/v1.0/contact/users/user%20%2F%20one');
  assert.deepEqual(calls[0].init.headers, {
    accept: 'application/json',
    'x-acs-dingtalk-access-token': 'app-token',
  });
});

test('direct unionId bypasses token and HTTP calls', async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const provider = createOperatorIdProvider({
    operatorId: 'union-direct',
    tokenProvider: { async getToken() { tokenCalls += 1; } },
    fetchImpl: async () => { fetchCalls += 1; },
  });

  assert.equal(await provider.getOperatorId(), 'union-direct');
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('maps lookup statuses and missing unionId safely', async () => {
  for (const [response, code] of [
    [jsonResponse({ message: 'secret' }, 401), 'AUTH_FAILED'],
    [jsonResponse({ message: 'secret' }, 403), 'DOCUMENT_FORBIDDEN'],
    [jsonResponse({ message: 'secret' }, 404), 'NOT_FOUND'],
    [jsonResponse({ display: 'no union' }), 'OPERATOR_RESOLUTION_FAILED'],
  ]) {
    const provider = createOperatorIdProvider({
      operatorUserId: 'user-id',
      tokenProvider: { async getToken() { return 'secret-token'; } },
      fetchImpl: async () => response,
    });
    await assert.rejects(provider.getOperatorId(), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret|user-id/);
      return true;
    });
  }
});

test('normalizes token and network failures without leaking details', async () => {
  const tokenFailure = createOperatorIdProvider({
    operatorUserId: 'user-id',
    tokenProvider: { async getToken() { throw new Error('secret-token'); } },
  });
  await assert.rejects(tokenFailure.getOperatorId(), (error) => (
    error.code === 'UPSTREAM_ERROR' && !/secret/.test(error.message)
  ));

  const networkFailure = createOperatorIdProvider({
    operatorUserId: 'user-id',
    tokenProvider: { async getToken() { return 'token'; } },
    fetchImpl: async () => { throw new Error('secret-network'); },
  });
  await assert.rejects(networkFailure.getOperatorId(), (error) => (
    error.code === 'UPSTREAM_ERROR' && !/secret/.test(error.message)
  ));
});
