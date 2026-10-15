import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blocksToMarkdown,
  blocksToText,
  normalizeDocument,
  sanitizeBlocks,
} from '../src/dingtalk-doc-content.js';

const representativeBlocks = [
  { id: 'p1', type: 'paragraph', content: [{ text: 'Hello ' }, { type: 'link', text: 'world', url: 'https://example.com/a b' }] },
  { id: 'h1', kind: 'heading', level: 2, content: { text: 'Overview' } },
  { type: 'unordered_list', items: [{ content: 'one' }, { text: 'two' }] },
  { type: 'ordered-list', items: [{ text: 'first' }, { content: [{ text: 'second' }] }] },
  { type: 'quote', content: 'quoted\nline' },
  { type: 'code_block', language: 'js', content: 'const x = 1;\n```' },
  { type: 'link', title: 'DingTalk', url: 'https://docs.dingtalk.com/a_(b)' },
  { type: 'table', rows: [{ cells: [{ text: 'A' }, { text: 'B|C' }] }, { cells: ['1', '2'] }] },
];

test('renders supported blocks as deterministic Markdown and readable text', () => {
  assert.equal(blocksToMarkdown(representativeBlocks), [
    'Hello [world](https://example.com/a%20b)',
    '## Overview',
    '- one\n- two',
    '1. first\n2. second',
    '> quoted\n> line',
    '````js\nconst x = 1;\n```\n````',
    '[DingTalk](https://docs.dingtalk.com/a_\\(b\\))',
    '| A | B\\|C |\n| --- | --- |\n| 1 | 2 |',
  ].join('\n\n'));

  assert.equal(blocksToText(representativeBlocks), [
    'Hello world (https://example.com/a b)', 'Overview', '- one\n- two', '1. first\n2. second',
    'quoted\nline', 'const x = 1;\n```', 'DingTalk (https://docs.dingtalk.com/a_(b))',
    'A\tB|C\n1\t2',
  ].join('\n\n'));
  assert.equal(blocksToMarkdown(representativeBlocks), blocksToMarkdown(representativeBlocks));
});

test('reads DingTalk nested element shapes without leaking unrelated fields', () => {
  const blocks = [{
    kind: 'paragraph',
    elements: [{ text: 'Ding' }, { kind: 'link', content: { text: 'Talk' }, url: 'https://example.com' }],
  }];
  assert.equal(blocksToMarkdown(blocks), 'Ding[Talk](https://example.com)');
  assert.equal(blocksToText(blocks), 'DingTalk (https://example.com)');
  assert.deepEqual(sanitizeBlocks(blocks), blocks);
});

test('accepts camelCase block type names from DingTalk payload variants', () => {
  assert.equal(blocksToMarkdown([
    { type: 'orderedList', items: [{ text: 'item' }] },
    { type: 'codeBlock', content: 'x' },
  ]), '1. item\n\n```\nx\n```');
});

test('sanitizes recursively by allowlist, strips secret-like keys, and does not mutate input', () => {
  const input = [{
    id: 'safe', type: 'paragraph', index: 1, text: 'visible', ignored: 'drop', tokenized: 'drop-too',
    content: { text: 'nested', style: { title: 'allowed nested title', appSecret: 'hide' }, cookieJar: 'hide' },
    children: [{ kind: 'link', title: 'site', url: 'https://example.com', authorization: 'hide' }],
  }];
  const snapshot = structuredClone(input);

  assert.deepEqual(sanitizeBlocks(input), [{
    id: 'safe', type: 'paragraph', index: 1, text: 'visible',
    content: { text: 'nested' },
    children: [{ kind: 'link', title: 'site', url: 'https://example.com' }],
  }]);
  assert.deepEqual(input, snapshot);
});

test('preserves unknown sanitized blocks and emits exact unsupported markers', () => {
  const blocks = [
    { type: 'diagram', text: 'not rendered', credential: 'hidden' },
    { kind: 'widget', content: { text: 'not rendered either' } },
    { type: 'diagram', text: 'again' },
  ];
  const result = normalizeDocument({ node: { id: 'n1', title: 'Doc' }, blocks });

  assert.deepEqual(result.blocks, [
    { type: 'diagram', text: 'not rendered' },
    { kind: 'widget', content: { text: 'not rendered either' } },
    { type: 'diagram', text: 'again' },
  ]);
  assert.equal(result.markdown, '[Unsupported block: diagram]\n\n[Unsupported block: widget]\n\n[Unsupported block: diagram]');
  assert.equal(result.text, result.markdown);
  assert.deepEqual(result.unsupportedBlockTypes, ['diagram', 'widget']);
});

test('normalizes document metadata and removes nested credentials everywhere', () => {
  const source = {
    node: {
      id: 'node-1', title: 'Safe title', type: 'document', url: 'https://docs.dingtalk.com/x',
      accessToken: 'hide', metadata: { title: 'drop because field not allowed', webhookUrl: 'hide' },
      children: [{ id: 'child', app_secret: 'hide', title: 'Safe child' }],
    },
    blocks: [{ type: 'paragraph', text: 'Body', secretValue: 'hide' }],
  };
  const result = normalizeDocument(source);

  assert.deepEqual(result, {
    node: {
      id: 'node-1', title: 'Safe title', type: 'document', url: 'https://docs.dingtalk.com/x',
      children: [{ id: 'child', title: 'Safe child' }],
    },
    contentType: 'markdown',
    markdown: 'Body',
    text: 'Body',
    blocks: [{ type: 'paragraph', text: 'Body' }],
    unsupportedBlockTypes: [],
    truncated: false,
  });
  assert.equal(JSON.stringify(result).includes('hide'), false);
});

test('handles null and malformed block inputs safely and deterministically', () => {
  for (const value of [null, undefined, {}, 'bad', 3]) {
    assert.deepEqual(sanitizeBlocks(value), []);
    assert.equal(blocksToMarkdown(value), '');
    assert.equal(blocksToText(value), '');
  }
  const odd = [null, 3, {}, { type: null }, { type: 'paragraph', content: Symbol('odd') }];
  assert.doesNotThrow(() => normalizeDocument({ node: null, blocks: odd }));
  assert.deepEqual(normalizeDocument({ node: null, blocks: odd }), {
    node: {}, contentType: 'markdown',
    markdown: '[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n',
    text: '[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n',
    blocks: [null, 3, {}, { type: null }, { type: 'paragraph' }],
    unsupportedBlockTypes: ['unknown'], truncated: false,
  });
});
