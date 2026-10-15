import { parseArgs } from 'node:util';

import { createTokenProvider } from './dingtalk-auth.js';
import { createDingTalkDocClient } from './dingtalk-doc-client.js';
import { normalizeDocument } from './dingtalk-doc-content.js';
import { loadToolConfig } from './dingtalk-tool-config.js';
import { ToolError, exitCodeFor, toErrorEnvelope } from './dingtalk-tool-error.js';

const OPTION_DEFINITIONS = {
  cursor: { type: 'string' },
  limit: { type: 'string' },
  'workspace-id': { type: 'string' },
  'parent-node-id': { type: 'string' },
  'node-id': { type: 'string' },
  url: { type: 'string' },
  format: { type: 'string' },
};

const COMMAND_OPTIONS = {
  health: [],
  workspaces: ['cursor', 'limit'],
  workspace: ['workspace-id'],
  nodes: ['workspace-id', 'parent-node-id', 'cursor', 'limit'],
  node: ['node-id'],
  resolve: ['url'],
  read: ['node-id', 'format'],
};

function invalid(message) {
  return new ToolError('INVALID_ARGUMENT', message);
}

function requireOption(values, name) {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`--${name} is required`);
  return value;
}

function limit(values, defaultValue) {
  if (values.limit === undefined) return defaultValue;
  if (!/^[0-9]+$/.test(values.limit)) throw invalid('--limit must be an integer from 1 to 100');
  const value = Number(values.limit);
  if (value < 1 || value > 100) throw invalid('--limit must be an integer from 1 to 100');
  return value;
}

function parse(argv) {
  let result;
  try {
    result = parseArgs({ args: argv, options: OPTION_DEFINITIONS, strict: true, allowPositionals: true });
  } catch {
    throw invalid('Invalid command arguments');
  }
  if (result.positionals.length !== 1) throw invalid('Exactly one command is required');
  const command = result.positionals[0];
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) throw invalid(`Unknown command: ${command}`);
  for (const name of Object.keys(result.values)) {
    if (!allowed.includes(name)) throw invalid(`--${name} is not valid for ${command}`);
  }
  return { command, values: result.values };
}

function validateCommand(command, values) {
  const required = {
    workspace: ['workspace-id'],
    nodes: ['workspace-id'],
    node: ['node-id'],
    resolve: ['url'],
    read: ['node-id'],
  };
  for (const name of required[command] ?? []) requireOption(values, name);
  for (const name of ['cursor', 'parent-node-id']) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw invalid(`--${name} must be a non-empty string`);
    }
  }
  if (command === 'workspaces') limit(values, 20);
  if (command === 'nodes') limit(values, 50);
  if (command === 'read' && values.format !== undefined
      && !['json', 'markdown', 'text', 'blocks'].includes(values.format)) {
    throw invalid('--format must be json, markdown, text, or blocks');
  }
}

function writeJson(write, value) {
  write(`${JSON.stringify(value)}\n`);
}

function success(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)
      && Object.hasOwn(result, 'data')) {
    const envelope = { ok: true, data: result.data };
    if (result.page !== undefined) envelope.page = result.page;
    return envelope;
  }
  return { ok: true, data: result };
}

function actualNode(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (result.data?.node && typeof result.data.node === 'object') return result.data.node;
  if (result.node && typeof result.node === 'object') return result.node;
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) return result.data;
  return result;
}

function actualBlocks(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.blocks)) return result.blocks;
  if (Array.isArray(result?.data?.blocks)) return result.data.blocks;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function assertDocumentType(node) {
  const marker = [node?.contentType, node?.type, node?.nodeType]
    .find((value) => typeof value === 'string' && value.trim());
  if (!marker) return;
  const canonical = marker.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!['alidoc', 'doc', 'document', 'dingtalkdoc'].includes(canonical)) {
    throw new ToolError('UNSUPPORTED_CONTENT_TYPE', 'Node content type is not a DingTalk document');
  }
}

async function readDocument(client, values, stdout) {
  const nodeId = requireOption(values, 'node-id');
  const format = values.format ?? 'json';
  if (!['json', 'markdown', 'text', 'blocks'].includes(format)) {
    throw invalid('--format must be json, markdown, text, or blocks');
  }
  const node = actualNode(await client.getNode(nodeId));
  assertDocumentType(node);
  const docKey = node?.docKey || node?.dentryUuid || nodeId;
  const blocks = actualBlocks(await client.getBlocks(docKey));
  const normalized = normalizeDocument({ node, blocks });
  if (format === 'markdown' || format === 'text') {
    stdout(`${normalized[format]}\n`);
  } else {
    writeJson(stdout, success(format === 'blocks' ? normalized.blocks : normalized));
  }
}

function defaultClientFactory({ config, tokenProvider, fetchImpl }) {
  return createDingTalkDocClient({ tokenProvider, operatorId: config.operatorId, fetchImpl });
}

export async function runCli(argv, {
  env = process.env,
  fetchImpl = fetch,
  createClient = defaultClientFactory,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
} = {}) {
  try {
    const { command, values } = parse(argv);
    validateCommand(command, values);
    const config = loadToolConfig(env);
    const tokenProvider = createTokenProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetchImpl,
    });
    const client = createClient({ config, tokenProvider, fetchImpl });

    let result;
    if (command === 'health') result = await client.health();
    if (command === 'workspaces') {
      result = await client.listWorkspaces({
        ...(values.cursor === undefined ? {} : { nextToken: values.cursor }),
        maxResults: limit(values, 20),
      });
    }
    if (command === 'workspace') result = await client.getWorkspace(requireOption(values, 'workspace-id'));
    if (command === 'nodes') {
      result = await client.listNodes({
        workspaceId: requireOption(values, 'workspace-id'),
        ...(values['parent-node-id'] === undefined ? {} : { parentNodeId: values['parent-node-id'] }),
        ...(values.cursor === undefined ? {} : { nextToken: values.cursor }),
        maxResults: limit(values, 50),
      });
    }
    if (command === 'node') result = await client.getNode(requireOption(values, 'node-id'));
    if (command === 'resolve') result = await client.resolveUrl(requireOption(values, 'url'));
    if (command === 'read') {
      await readDocument(client, values, stdout);
      return 0;
    }
    writeJson(stdout, success(result));
    return 0;
  } catch (error) {
    writeJson(stderr, toErrorEnvelope(error));
    return exitCodeFor(error);
  }
}
