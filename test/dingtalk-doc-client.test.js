import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDingTalkDocClient } from '../src/dingtalk-doc-client.js';
import { ToolError } from '../src/dingtalk-tool-error.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

function harness(responses = [{}], options = {}) {
  const calls = [];
  const tokenCalls = [];
  const client = createDingTalkDocClient({
    operatorId: 'operator / one',
    tokenProvider: {
      async getToken(input) {
        tokenCalls.push(input);
        return input?.forceRefresh ? 'fresh-token' : 'initial-token';
      },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const response = responses.shift();
      return response instanceof Response ? response : jsonResponse(response);
    },
    ...options,
  });
  return { client, calls, tokenCalls };
}

test('listWorkspaces sends exact authenticated request and normalizes pagination', async () => {
  const payload = await fixture('dingtalk-workspaces.json');
  const { client, calls } = harness([payload]);
  const result = await client.listWorkspaces({ maxResults: 25, nextToken: 'next / token' });

  assert.deepEqual(result, {
    data: payload.workspaces,
    page: { nextCursor: 'workspace-page-2', hasMore: true },
  });
  assert.equal(calls[0].url, 'https://api.dingtalk.com/v2.0/wiki/workspaces?operatorId=operator+%2F+one&maxResults=25&nextToken=next+%2F+token');
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual(calls[0].init.headers, {
    accept: 'application/json',
    'x-acs-dingtalk-access-token': 'initial-token',
  });
});

test('document methods encode path and query values and preserve response data', async () => {
  const node = await fixture('dingtalk-node.json');
  const blocks = await fixture('dingtalk-blocks.json');
  const { client, calls } = harness([{ workspaceId: 'ws / 1' }, node, blocks]);

  assert.deepEqual(await client.getWorkspace('ws / 1'), { workspaceId: 'ws / 1' });
  assert.deepEqual(await client.getNode('node / 1'), node);
  assert.deepEqual(await client.getBlocks('doc / 1'), blocks);
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://api.dingtalk.com/v2.0/wiki/workspaces/ws%20%2F%201?operatorId=operator+%2F+one',
    'https://api.dingtalk.com/v2.0/wiki/nodes/node%20%2F%201?operatorId=operator+%2F+one',
    'https://api.dingtalk.com/v1.0/doc/suites/documents/doc%20%2F%201/blocks?operatorId=operator+%2F+one',
  ]);
});

test('listNodes sends optional parent and normalizes terminal page', async () => {
  const payload = await fixture('dingtalk-nodes.json');
  delete payload.nextToken;
  const { client, calls } = harness([payload]);
  assert.deepEqual(await client.listNodes({ workspaceId: 'ws-1', parentNodeId: 'parent-1' }), {
    data: payload.nodes,
    page: { nextCursor: null, hasMore: false },
  });
  assert.equal(calls[0].url, 'https://api.dingtalk.com/v2.0/wiki/nodes?workspaceId=ws-1&parentNodeId=parent-1&operatorId=operator+%2F+one&maxResults=50');
});

test('resolveUrl validates and sends exact POST request', async () => {
  const url = 'https://docs.dingtalk.com/i/nodes/abc?x=1';
  const { client, calls } = harness([{ nodeId: 'node-1' }]);
  assert.deepEqual(await client.resolveUrl(url), { nodeId: 'node-1' });
  assert.equal(calls[0].url, 'https://api.dingtalk.com/v2.0/wiki/nodes/queryByUrl?operatorId=operator+%2F+one');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url, operatorId: 'operator / one' });
});

test('resolveUrl rejects unsafe URLs before token or fetch', async () => {
  const rejected = [
    'http://docs.dingtalk.com/a',
    'https://user:pass@docs.dingtalk.com/a',
    'https://docs.dingtalk.com:444/a',
    'https://docs.dingtalk.com.evil.test/a',
    'not a url',
  ];
  const { client, calls, tokenCalls } = harness([]);
  for (const url of rejected) {
    await assert.rejects(client.resolveUrl(url), (error) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
  }
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
});

test('health makes a real authenticated request', async () => {
  const { client, calls } = harness([{ workspaces: [] }]);
  assert.deepEqual(await client.health(), {
    authenticated: true,
    operatorIdConfigured: true,
    dingTalkReachable: true,
  });
  assert.equal(calls[0].url, 'https://api.dingtalk.com/v2.0/wiki/workspaces?operatorId=operator+%2F+one&maxResults=1');
});

test('validates IDs, pagination, and constructor arguments before request', async () => {
  const { client, calls, tokenCalls } = harness([]);
  for (const operation of [
    () => client.getWorkspace(' '),
    () => client.getNode(''),
    () => client.getBlocks(null),
    () => client.listNodes({ workspaceId: ' ' }),
    () => client.listWorkspaces({ maxResults: 0 }),
    () => client.listWorkspaces({ maxResults: 101 }),
    () => client.listWorkspaces({ maxResults: 1.5 }),
    () => client.listWorkspaces({ nextToken: ' ' }),
  ]) await assert.rejects(operation, (error) => error.code === 'INVALID_ARGUMENT');
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
  assert.throws(() => createDingTalkDocClient({ tokenProvider: {}, operatorId: '' }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('retries exactly once on 401 with forced token refresh', async () => {
  const { client, calls, tokenCalls } = harness([
    jsonResponse({}, 401),
    jsonResponse({ nodeId: 'ok' }),
  ]);
  assert.deepEqual(await client.getNode('node-1'), { nodeId: 'ok' });
  assert.equal(calls.length, 2);
  assert.deepEqual(tokenCalls, [undefined, { forceRefresh: true }]);
  assert.equal(calls[1].init.headers['x-acs-dingtalk-access-token'], 'fresh-token');
});

test('maps HTTP statuses without exposing upstream body', async () => {
  for (const [status, code] of [[400, 'INVALID_ARGUMENT'], [401, 'AUTH_FAILED'], [403, 'DOCUMENT_FORBIDDEN'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [500, 'UPSTREAM_ERROR']]) {
    const { client } = harness(status === 401
      ? [jsonResponse({ message: 'raw-secret-url' }, status), jsonResponse({ message: 'raw-secret-url' }, status)]
      : [jsonResponse({ message: 'raw-secret-url' }, status, status === 429 ? { 'retry-after': '12' } : {})]);
    await assert.rejects(client.getNode('node-1'), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /raw-secret-url|initial-token|node-1/);
      if (status === 429) assert.equal(error.retryAfter, '12');
      return true;
    });
  }
});

test('maps timeout and network failures to safe errors', async () => {
  const timeout = harness([], {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('sensitive timeout', 'AbortError')));
    }),
  }).client;
  await assert.rejects(timeout.getNode('node-1'), (error) => error.code === 'UPSTREAM_TIMEOUT' && !/sensitive/.test(error.message));

  const network = harness([], { fetchImpl: async () => { throw new Error('token=https://secret'); } }).client;
  await assert.rejects(network.getNode('node-1'), (error) => error.code === 'UPSTREAM_ERROR' && !/secret/.test(error.message));
});

test('rejects content-length and actual bodies over maxResponseBytes', async () => {
  const declared = harness([new Response('{}', { headers: { 'content-length': '99' } })], { maxResponseBytes: 8 }).client;
  await assert.rejects(declared.getNode('node'), (error) => error.code === 'UPSTREAM_ERROR');

  const actual = harness([new Response(JSON.stringify({ long: 'payload' }))], { maxResponseBytes: 8 }).client;
  await assert.rejects(actual.getNode('node'), (error) => error.code === 'UPSTREAM_ERROR');
});

test('stops and cancels streamed body as soon as cumulative bytes exceed limit', async () => {
  let pulls = 0;
  let cancelled = false;
  const chunks = [
    new TextEncoder().encode('{"a":"'),
    new TextEncoder().encode('too-long'),
    new TextEncoder().encode('never-consumed"}'),
  ];
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunks.shift());
      if (chunks.length === 0) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const client = harness([new Response(body)], { maxResponseBytes: 10 }).client;

  await assert.rejects(client.getNode('node'), (error) => error.code === 'UPSTREAM_ERROR');
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
  assert.equal(chunks.length, 1);
});

test('size overflow rejects promptly when stream cancellation never settles', async () => {
  let cancelCalled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(11));
    },
    cancel() {
      cancelCalled = true;
      return new Promise(() => {});
    },
  }, { highWaterMark: 0 });
  const client = harness([new Response(body)], { maxResponseBytes: 10, timeoutMs: 1_000 }).client;

  const outcome = await Promise.race([
    client.getNode('node').then(() => 'resolved', (error) => error.code),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 25)),
  ]);
  assert.equal(outcome, 'UPSTREAM_ERROR');
  assert.equal(cancelCalled, true);
});

test('rejects malformed JSON and bounds response body reading by timeout', async () => {
  const malformed = harness([new Response('not-json')]).client;
  await assert.rejects(malformed.getNode('node'), (error) => error.code === 'UPSTREAM_ERROR');

  const stalled = harness([], {
    timeoutMs: 5,
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new Promise(() => {}) }),
  }).client;
  await assert.rejects(stalled.getNode('node'), (error) => error.code === 'UPSTREAM_TIMEOUT');
});

