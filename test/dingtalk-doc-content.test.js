import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const realBlocks = JSON.parse(readFileSync(new URL('./fixtures/dingtalk-real-blocks.json', import.meta.url)));

test('normalizes and renders realistic blockType payload objects', () => {
  const result = normalizeDocument({
    node: { type: 'FILE', category: 'ALIDOC', nodeId: 'real-node', title: 'Real' },
    blocks: realBlocks,
  });

  assert.equal(result.markdown, [
    'Hello ', '## Real document', '### String level', '- one\n- two', '1. first', '> quoted',
    '```js\nconst x = 1;\n```', '[safe](https://example.com/path?keep=yes)',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
  ].join('\n\n'));
  assert.equal(result.text, [
    'Hello ', 'Real document', 'String level', '- one\n- two', '1. first', 'quoted',
    'const x = 1;', 'safe (https://example.com/path?keep=yes)', 'A\tB\n1\t2',
  ].join('\n\n'));
  assert.deepEqual(result.unsupportedBlockTypes, []);
  assert.equal(result.blocks[0].blockType, 'paragraph');
  assert.deepEqual(result.blocks[0].paragraph, { text: 'Hello ' });
  assert.doesNotMatch(JSON.stringify(result), /hide|#secret|token=/i);
});

test('sanitizes URL credentials, unsafe schemes, sensitive query params, and fragments', () => {
  const safe = sanitizeBlocks([
    { type: 'link', url: 'https://example.com/a?keep=1&author=alice&postcode=90210&designation=owner&access_token=hide&api_key=hide&signature=hide#frag' },
    { type: 'link', url: 'https://user:pass@example.com/private' },
    { type: 'link', url: 'javascript:alert(1)' },
  ]);
  assert.deepEqual(safe, [
    { type: 'link', url: 'https://example.com/a?keep=1&author=alice&postcode=90210&designation=owner' },
    { type: 'link', url: '' },
    { type: 'link', url: '' },
  ]);
});

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

test('escapes Markdown syntax from plain text leaves and rejects unsafe structured links', () => {
  const blocks = [
    { type: 'paragraph', text: '![click](javascript:alert(1)) [data](data:text/html,bad) <img src=x>' },
    { type: 'heading', level: 2, text: '# title *bold*' },
    { type: 'quote', text: '> injected' },
    { type: 'unorderedList', items: [{ text: '[item](javascript:bad)' }] },
    { type: 'link', title: '[unsafe](javascript:bad)', url: 'javascript:alert(1)' },
    { type: 'link', title: 'data image', url: 'data:image/svg+xml,bad' },
    { type: 'table', rows: [{ cells: [{ text: '*cell*|next' }] }] },
  ];

  assert.equal(blocksToMarkdown(blocks), [
    '\\!\\[click\\]\\(javascript:alert\\(1\\)\\) \\[data\\]\\(data:text/html,bad\\) \\<img src=x\\>',
    '## \\# title \\*bold\\*',
    '> \\> injected',
    '- \\[item\\]\\(javascript:bad\\)',
    '\\[unsafe\\]\\(javascript:bad\\)',
    'data image',
    '| \\*cell\\*\\|next |\n| --- |',
  ].join('\n\n'));
  assert.doesNotMatch(blocksToMarkdown(blocks), /\]\((?:javascript|data):/i);
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
    contentType: 'document',
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
    node: {}, contentType: null,
    markdown: '[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n',
    text: '[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n[Unsupported block: unknown]\n\n',
    blocks: [null, 3, {}, { type: null }, { type: 'paragraph' }],
    unsupportedBlockTypes: ['unknown'], truncated: false,
  });
});

test('sanitization handles cycles and excessive nesting deterministically', () => {
  const cyclic = { type: 'paragraph', text: 'safe' };
  cyclic.children = [cyclic];
  let deep = { text: 'bottom' };
  for (let index = 0; index < 80; index += 1) deep = { content: deep };

  assert.doesNotThrow(() => sanitizeBlocks([cyclic, deep]));
  const first = sanitizeBlocks([cyclic, deep]);
  const second = sanitizeBlocks([cyclic, deep]);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], { type: 'paragraph', text: 'safe', children: ['[Circular]'] });
  assert.match(JSON.stringify(first[1]), /\[Max depth\]/);
});

test('renders very large code blocks without argument-list overflow', () => {
  const code = '`x'.repeat(150_000);
  const markdown = blocksToMarkdown([{ type: 'codeBlock', language: 'js', content: code }]);
  assert.equal(markdown.length, code.length + 10);
  assert.equal(markdown.slice(0, 6), '```js\n');
  assert.equal(markdown.slice(-4), '\n```');
});

test('normalizes contentType from sanitized node metadata with type fallback', () => {
  assert.equal(normalizeDocument({ node: { contentType: 'sheet', type: 'document' }, blocks: [] }).contentType, 'sheet');
  assert.equal(normalizeDocument({ node: { type: 'document' }, blocks: [] }).contentType, 'document');
  assert.equal(normalizeDocument({ node: { contentType: '', type: 'document' }, blocks: [] }).contentType, 'document');
  assert.equal(normalizeDocument({ node: { contentType: 4, type: '  ' }, blocks: [] }).contentType, null);
  assert.equal(normalizeDocument({ node: {}, blocks: [] }).contentType, null);
});
