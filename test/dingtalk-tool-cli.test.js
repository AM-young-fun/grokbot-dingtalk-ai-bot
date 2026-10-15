import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCli } from '../src/dingtalk-tool-cli.js';
import { ToolError } from '../src/dingtalk-tool-error.js';

const execFileAsync = promisify(execFile);
const env = {
  DINGTALK_CLIENT_ID: 'client',
  DINGTALK_CLIENT_SECRET: 'secret',
  DINGTALK_OPERATOR_ID: 'operator',
};
const realBlocks = JSON.parse(readFileSync(new URL('./fixtures/dingtalk-real-blocks.json', import.meta.url)));

function harness(client, overrides = {}) {
  let stdout = '';
  let stderr = '';
  const factoryCalls = [];
  return {
    run(argv) {
      return runCli(argv, {
        env,
        fetchImpl: overrides.fetchImpl ?? (() => { throw new Error('unexpected fetch'); }),
        createClient(input) {
          factoryCalls.push(input);
          return client;
        },
        stdout(value) { stdout += value; },
        stderr(value) { stderr += value; },
      });
    },
    factoryCalls,
    output() { return { stdout, stderr }; },
  };
}

test('dispatches every non-read command with exact arguments and JSON envelopes', async () => {
  const calls = [];
  const client = {
    async health() { calls.push(['health']); return { healthy: true, authenticated: true }; },
    async listWorkspaces(value) { calls.push(['listWorkspaces', value]); return { data: ['w'], page: { hasMore: true } }; },
    async getWorkspace(value) { calls.push(['getWorkspace', value]); return { id: value }; },
    async listNodes(value) { calls.push(['listNodes', value]); return { data: ['n'], page: { hasMore: false } }; },
    async getNode(value) { calls.push(['getNode', value]); return { id: value }; },
    async resolveUrl(value) { calls.push(['resolveUrl', value]); return { id: 'resolved' }; },
  };
  const cases = [
    [['health'], ['health']],
    [['workspaces', '--cursor', 'next', '--limit', '7'], ['listWorkspaces', { nextToken: 'next', maxResults: 7 }]],
    [['workspace', '--workspace-id', 'w1'], ['getWorkspace', 'w1']],
    [['nodes', '--workspace-id', 'w1', '--parent-node-id', 'p1', '--cursor', 'next', '--limit', '8'], ['listNodes', { workspaceId: 'w1', parentNodeId: 'p1', nextToken: 'next', maxResults: 8 }]],
    [['node', '--node-id', 'n1'], ['getNode', 'n1']],
    [['resolve', '--url', 'https://docs.dingtalk.com/i/nodes/a'], ['resolveUrl', 'https://docs.dingtalk.com/i/nodes/a']],
  ];

  for (const [argv, expected] of cases) {
    const h = harness(client);
    assert.equal(await h.run(argv), 0);
    assert.deepEqual(calls.at(-1), expected);
    const parsed = JSON.parse(h.output().stdout);
    assert.equal(parsed.ok, true);
    if (argv[0] === 'health') assert.equal(parsed.data.authenticated, true);
    assert.equal(h.output().stderr, '');
  }
  assert.deepEqual(JSON.parse(harness(client).output().stdout || 'null'), null);
});

test('uses default list limits and omits absent optional arguments', async () => {
  const calls = [];
  const client = {
    async listWorkspaces(value) { calls.push(value); return { data: [] }; },
    async listNodes(value) { calls.push(value); return { data: [] }; },
  };
  const first = harness(client);
  await first.run(['workspaces']);
  const second = harness(client);
  await second.run(['nodes', '--workspace-id', 'w']);
  assert.deepEqual(calls, [{ maxResults: 20 }, { workspaceId: 'w', maxResults: 50 }]);
  assert.deepEqual(JSON.parse(first.output().stdout), { ok: true, data: [] });
});

test('loads config and supplies token provider inputs to the client factory', async () => {
  const fetchImpl = async () => new Response('{}');
  const h = harness({ async health() { return {}; } }, { fetchImpl });
  await h.run(['health']);
  assert.equal(h.factoryCalls.length, 1);
  assert.deepEqual(h.factoryCalls[0].config, { clientId: 'client', clientSecret: 'secret', operatorId: 'operator' });
  assert.equal(h.factoryCalls[0].fetchImpl, fetchImpl);
  assert.equal(typeof h.factoryCalls[0].tokenProvider.getToken, 'function');
});

test('rejects unknown commands, options, extra positionals, missing flags, invalid limits, and invalid formats', async () => {
  const invalid = [
    [], ['bogus'], ['health', 'extra'], ['health', '--cursor', 'x'], ['node'],
    ['workspace', '--workspace-id', ''], ['nodes'], ['workspaces', '--limit', '0'],
    ['workspaces', '--limit', '101'], ['workspaces', '--limit', '1.5'], ['read', '--node-id', 'n', '--format', 'xml'],
  ];
  for (const argv of invalid) {
    const h = harness({});
    assert.equal(await h.run(argv), 2, argv.join(' '));
    assert.equal(h.output().stdout, '');
    const envelope = JSON.parse(h.output().stderr);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'INVALID_ARGUMENT');
  }
});

test('validates command-specific arguments before configuration or client creation', async () => {
  let created = false;
  let stderr = '';
  const exitCode = await runCli(['node'], {
    env: {},
    createClient() { created = true; return {}; },
    stdout() {},
    stderr(value) { stderr += value; },
  });
  assert.equal(exitCode, 2);
  assert.equal(created, false);
  assert.equal(JSON.parse(stderr).error.code, 'INVALID_ARGUMENT');
});

test('read gets node and blocks, unwraps common responses, and emits normalized JSON by default', async () => {
  const calls = [];
  const node = { nodeId: 'n1', docKey: 'doc1', contentType: 'ALIDOC', title: 'Title' };
  const blocks = [{ type: 'paragraph', content: 'Hello', accessToken: 'remove' }];
  const client = {
    async getNode(id) { calls.push(['getNode', id]); return { data: { node } }; },
    async getBlocks(key) { calls.push(['getBlocks', key]); return { data: { blocks } }; },
  };
  const h = harness(client);
  assert.equal(await h.run(['read', '--node-id', 'n1']), 0);
  assert.deepEqual(calls, [['getNode', 'n1'], ['getBlocks', 'doc1']]);
  const output = JSON.parse(h.output().stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data.markdown, 'Hello');
  assert.deepEqual(output.data.blocks, [{ type: 'paragraph', content: 'Hello' }]);
});

test('read accepts realistic FILE plus ALIDOC node and result data blocks envelope', async () => {
  const h = harness({
    async getNode() {
      return { result: { data: { node: { nodeId: 'n-real', docKey: 'doc-real', type: 'FILE', category: 'ALIDOC' } } } };
    },
    async getBlocks(key) {
      assert.equal(key, 'doc-real');
      return { result: { data: realBlocks } };
    },
  });
  assert.equal(await h.run(['read', '--node-id', 'n-real']), 0);
  const output = JSON.parse(h.output().stdout);
  assert.match(output.data.markdown, /Real document/);
  assert.deepEqual(output.data.unsupportedBlockTypes, ['mindMap']);
});

test('read fails safely for unknown and confirmed non-ALIDOC node metadata', async () => {
  for (const node of [
    { nodeId: 'unknown', type: 'FILE' },
    { nodeId: 'sheet', type: 'FILE', category: 'WORKBOOK' },
    { nodeId: 'pdf', fileType: 'PDF' },
  ]) {
    const h = harness({
      async getNode() { return { result: { node } }; },
      async getBlocks() { throw new Error('must not load blocks'); },
    });
    assert.equal(await h.run(['read', '--node-id', node.nodeId]), 5);
    assert.equal(JSON.parse(h.output().stderr).error.code, 'UNSUPPORTED_CONTENT_TYPE');
  }
});

test('sanitizes nested secrets and credential-bearing URLs in every JSON command output', async () => {
  const dangerous = {
    id: 'keep-id', name: 'keep-name', title: 'note: keep me', authenticated: true,
    authentication: true, authenticationState: true, page: { nextCursor: 'keep-page' },
    accessToken: 'hide-token', nested: {
      secret: 'hide-secret',
      authorizationHeader: 'hide-authorization-header',
      authorizationCode: 'hide-authorization-code',
      signingKey: 'hide-signing-key',
      password: 'hide-password',
      passphrase: 'hide-passphrase',
      apiKey: 'hide-api-key',
      privateKey: 'hide-private-key',
      clientKey: 'hide-client-key',
      url: 'https://user:pass@example.com/a?authorization=hide&keep=1#frag',
      publicUrl: 'https://example.com/a?keep=1&ticket=hide#frag',
    },
  };
  const client = {
    async health() { return dangerous; },
    async listWorkspaces() { return { data: [dangerous], page: dangerous.page }; },
    async getWorkspace() { return dangerous; },
    async listNodes() { return { data: [dangerous], page: dangerous.page }; },
    async getNode() { return dangerous; },
    async resolveUrl() { return dangerous; },
  };
  for (const argv of [
    ['health'], ['workspaces'], ['workspace', '--workspace-id', 'w'],
    ['nodes', '--workspace-id', 'w'], ['node', '--node-id', 'n'],
    ['resolve', '--url', 'https://docs.dingtalk.com/a'],
  ]) {
    const h = harness(client);
    assert.equal(await h.run(argv), 0);
    assert.doesNotMatch(h.output().stdout, /hide-|user:pass|authorization=|ticket=|#frag/i);
    assert.match(h.output().stdout, /keep-id|keep-page/);
    const output = JSON.parse(h.output().stdout);
    const serialized = JSON.stringify(output);
    assert.match(serialized, /note: keep me/);
    assert.match(serialized, /authenticated/);
    assert.match(serialized, /"authentication":true/);
    assert.match(serialized, /authenticationState/);
    assert.doesNotMatch(serialized, /authorizationHeader|authorizationCode|signingKey|password|passphrase|apiKey|privateKey|clientKey/);
  }
});

test('read supports blocks, markdown, and text formats with node-id doc key fallback', async () => {
  const blocks = [{ type: 'heading', level: 2, content: 'Hello' }];
  for (const [format, expected] of [
    ['blocks', JSON.stringify({ ok: true, data: blocks })],
    ['markdown', '## Hello'],
    ['text', 'Hello'],
  ]) {
    const keys = [];
    const h = harness({
      async getNode() { return { data: { id: 'n1', type: 'document' } }; },
      async getBlocks(key) { keys.push(key); return blocks; },
    });
    assert.equal(await h.run(['read', '--node-id', 'n1', '--format', format]), 0);
    assert.equal(h.output().stdout.trimEnd(), expected);
    assert.deepEqual(keys, ['n1']);
  }
});

test('read accepts dentryUuid and rejects confirmed non-document content types', async () => {
  const accepted = harness({
    async getNode() { return { node: { dentryUuid: 'entry1', contentType: 'DOC' } }; },
    async getBlocks(key) { assert.equal(key, 'entry1'); return []; },
  });
  assert.equal(await accepted.run(['read', '--node-id', 'n']), 0);

  const rejected = harness({
    async getNode() { return { data: { nodeId: 'n', contentType: 'SHEET' } }; },
    async getBlocks() { throw new Error('must not load blocks'); },
  });
  assert.equal(await rejected.run(['read', '--node-id', 'n']), 5);
  assert.equal(rejected.output().stdout, '');
  assert.equal(JSON.parse(rejected.output().stderr).error.code, 'UNSUPPORTED_CONTENT_TYPE');
});

test('read rejects malformed block response envelopes instead of returning an empty document', async () => {
  for (const response of [null, { error: {} }, { data: { unexpected: [] } }]) {
    const h = harness({
      async getNode() { return { nodeId: 'n', docKey: 'doc', contentType: 'ALIDOC' }; },
      async getBlocks() { return response; },
    });
    assert.equal(await h.run(['read', '--node-id', 'n']), 7);
    assert.equal(h.output().stdout, '');
    assert.deepEqual(JSON.parse(h.output().stderr), {
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'DingTalk returned malformed document blocks' },
    });
  }
});

test('writes safe ToolError and unexpected error envelopes only to stderr', async () => {
  for (const [error, code, exitCode] of [
    [new ToolError('RATE_LIMITED', 'Slow down', { retryAfter: '3' }), 'RATE_LIMITED', 6],
    [new Error('secret detail'), 'UNEXPECTED', 1],
  ]) {
    const h = harness({ async health() { throw error; } });
    assert.equal(await h.run(['health']), exitCode);
    assert.equal(h.output().stdout, '');
    const output = JSON.parse(h.output().stderr);
    assert.equal(output.error.code, code);
    assert.doesNotMatch(h.output().stderr, /secret detail/);
  }
});

test('bin reports missing configuration as safe JSON and exits 3', async () => {
  const cleanEnv = { PATH: process.env.PATH };
  await assert.rejects(
    execFileAsync(process.execPath, ['bin/dingtalk-grokbot-tool.js', 'health'], {
      cwd: new URL('..', import.meta.url),
      env: cleanEnv,
    }),
    (error) => {
      assert.equal(error.code, 3);
      assert.equal(error.stdout, '');
      assert.equal(JSON.parse(error.stderr).error.code, 'CONFIG_MISSING');
      assert.doesNotMatch(error.stderr, /undefined/);
      return true;
    },
  );
});
