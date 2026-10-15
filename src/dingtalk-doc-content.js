const SAFE_FIELDS = new Set([
  'id', 'index', 'type', 'kind', 'blockType', 'category', 'fileType', 'nodeType',
  'text', 'content', 'children', 'element', 'elements', 'items',
  'rows', 'cells', 'url', 'title', 'language', 'level', 'name', 'value', 'contentType',
  'docKey', 'nodeId', 'workspaceId', 'parentNodeId',
  'paragraph', 'heading', 'unorderedList', 'orderedList', 'quote', 'codeBlock', 'link', 'table',
]);
const SECRET_KEY = /token|secret|authorization|credential|cookie|webhook|session|ticket|signature|(?:^|[_-])sign(?:$|[_-])|app[_-]?secret/i;
const SENSITIVE_QUERY_KEY = /token|secret|access_token|authorization|credential|code|signature|sign|ticket|auth|session|webhook/i;
const MAX_DEPTH = 64;
const CIRCULAR_MARKER = '[Circular]';
const DEPTH_MARKER = '[Max depth]';

function sanitizeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    let changed = parsed.hash !== '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    parsed.hash = '';
    return changed ? parsed.toString() : value;
  } catch {
    return '';
  }
}

function isSensitiveOutputKey(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (['authenticated', 'authentication', 'authenticationstate'].includes(normalized)) return false;
  if (/token|secret|credential|signature|ticket|session|webhook/.test(normalized)) return true;
  return ['authorization', 'code', 'sign', 'auth', 'authcode', 'authtoken', 'authsecret', 'authcredential']
    .includes(normalized);
}

function keyIsSensitive(matcher, key) {
  return typeof matcher === 'function' ? matcher(key) : matcher.test(key);
}

function sanitizeRecursive(value, { allowlist = null, secretKey = SECRET_KEY } = {}, ancestors = new WeakSet(), depth = 0, key = '') {
  if (depth >= MAX_DEPTH) return DEPTH_MARKER;
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'string') {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const urlKey = /(?:url|uri)$/.test(normalizedKey)
      || ['url', 'uri', 'href', 'link', 'webhook', 'downloadlink'].includes(normalizedKey);
    const explicitUrl = /^https?:\/\//i.test(value) || /^(?:javascript|data):/i.test(value);
    const looksLikeUrl = urlKey || explicitUrl;
    return looksLikeUrl ? sanitizeUrl(value) : value;
  }
  if (!value || typeof value !== 'object') return undefined;

  if (ancestors.has(value)) return CIRCULAR_MARKER;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child) => sanitizeRecursive(child, { allowlist, secretKey }, ancestors, depth + 1));
    }

    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (keyIsSensitive(secretKey, key) || (allowlist && !allowlist.has(key))) continue;
      const safeChild = sanitizeRecursive(child, { allowlist, secretKey }, ancestors, depth + 1, key);
      if (safeChild !== undefined) output[key] = safeChild;
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function sanitizeValue(value) {
  return sanitizeRecursive(value, { allowlist: SAFE_FIELDS });
}

export function sanitizeOutput(value) {
  return sanitizeRecursive(value, { secretKey: isSensitiveOutputKey });
}

export function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block) => sanitizeValue(block));
}

function blockType(block) {
  if (!block || typeof block !== 'object') return 'unknown';
  const value = [block.blockType, block.type, block.kind]
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function canonicalType(block) {
  return blockType(block)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function plain(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plain).join('');
  if (!value || typeof value !== 'object') return '';
  if (value.text !== undefined) return plain(value.text);
  if (value.content !== undefined) return plain(value.content);
  if (value.children !== undefined) return plain(value.children);
  if (value.elements !== undefined) return plain(value.elements);
  if (value.element !== undefined) return plain(value.element);
  if (value.value !== undefined) return plain(value.value);
  return '';
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_[\]{}()#+\-.!><|])/g, '\\$1');
}

function safeMarkdownUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return encodeURI(value).replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  } catch {
    return null;
  }
}

function inlineMarkdown(value) {
  if (Array.isArray(value)) return value.map(inlineMarkdown).join('');
  if (!value || typeof value !== 'object') return escapeMarkdown(plain(value));
  if (canonicalType(value) === 'link' || value.url !== undefined) {
    const label = plain(value.text ?? value.title ?? value.content) || plain(value.url);
    const url = safeMarkdownUrl(value.url);
    const safeLabel = escapeMarkdown(label);
    return url ? `[${safeLabel}](${url})` : safeLabel;
  }
  return inlineMarkdown(value.text ?? value.content ?? value.children ?? value.elements ?? value.element ?? value.value);
}

function inlineText(value) {
  if (Array.isArray(value)) return value.map(inlineText).join('');
  if (!value || typeof value !== 'object') return plain(value);
  if (canonicalType(value) === 'link' || value.url !== undefined) {
    const label = plain(value.text ?? value.title ?? value.content) || plain(value.url);
    return typeof value.url === 'string' && label !== value.url ? `${label} (${value.url})` : label;
  }
  return inlineText(value.text ?? value.content ?? value.children ?? value.elements ?? value.element ?? value.value);
}

function contentOf(block) {
  const payload = payloadOf(block);
  return payload?.content ?? payload?.children ?? payload?.elements ?? payload?.element
    ?? payload?.text ?? payload?.value ?? '';
}

function payloadOf(block) {
  if (!block || typeof block !== 'object') return block;
  const type = canonicalType(block);
  const payloadKeys = {
    paragraph: 'paragraph', heading: 'heading', unordered_list: 'unorderedList',
    ordered_list: 'orderedList', quote: 'quote', code_block: 'codeBlock', link: 'link', table: 'table',
  };
  return block[payloadKeys[type]] ?? block;
}

function listItems(block) {
  const payload = payloadOf(block);
  return Array.isArray(payload?.items) ? payload.items
    : Array.isArray(payload?.children) ? payload.children : [];
}

function tableRows(block, renderCell) {
  const payload = payloadOf(block);
  if (!Array.isArray(payload?.rows)) return [];
  return payload.rows.map((row) => {
    const cells = Array.isArray(row) ? row : Array.isArray(row?.cells) ? row.cells : [];
    return cells.map(renderCell);
  });
}

function longestBacktickRun(value) {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === '`') {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

function markdownBlock(block) {
  const rawType = blockType(block);
  const type = canonicalType(block);
  if (type === 'paragraph') return inlineMarkdown(contentOf(block));
  if (type === 'heading') {
    const levelValue = payloadOf(block)?.level;
    const level = Number.isInteger(levelValue) ? Math.min(6, Math.max(1, levelValue)) : 1;
    return `${'#'.repeat(level)} ${inlineMarkdown(contentOf(block))}`.trimEnd();
  }
  if (['unordered_list', 'bullet_list', 'ul'].includes(type)) {
    return listItems(block).map((item) => `- ${inlineMarkdown(contentOf(item))}`).join('\n');
  }
  if (['ordered_list', 'numbered_list', 'ol'].includes(type)) {
    return listItems(block).map((item, index) => `${index + 1}. ${inlineMarkdown(contentOf(item))}`).join('\n');
  }
  if (['quote', 'blockquote'].includes(type)) {
    return inlineMarkdown(contentOf(block)).split('\n').map((line) => `> ${line}`).join('\n');
  }
  if (['code_block', 'code'].includes(type)) {
    const code = plain(contentOf(block));
    const longest = longestBacktickRun(code);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const languageValue = payloadOf(block)?.language;
    const language = typeof languageValue === 'string' ? languageValue.replace(/[^\w.+-]/g, '') : '';
    return `${fence}${language}\n${code}\n${fence}`;
  }
  if (type === 'link') return inlineMarkdown(payloadOf(block));
  if (type === 'table') {
    const rows = tableRows(block, (cell) => inlineMarkdown(cell).replace(/\n/g, '<br>'));
    if (!rows.length) return '';
    const width = Math.max(1, ...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
    return [normalized[0], Array(width).fill('---'), ...normalized.slice(1)]
      .map((row) => `| ${row.join(' | ')} |`).join('\n');
  }
  return `[Unsupported block: ${escapeMarkdown(rawType)}]`;
}

function textBlock(block) {
  const rawType = blockType(block);
  const type = canonicalType(block);
  if (['paragraph', 'heading', 'quote', 'code_block', 'code'].includes(type)) return inlineText(contentOf(block));
  if (['unordered_list', 'bullet_list', 'ul'].includes(type)) {
    return listItems(block).map((item) => `- ${inlineText(contentOf(item))}`).join('\n');
  }
  if (['ordered_list', 'numbered_list', 'ol'].includes(type)) {
    return listItems(block).map((item, index) => `${index + 1}. ${inlineText(contentOf(item))}`).join('\n');
  }
  if (type === 'link') return inlineText(payloadOf(block));
  if (type === 'table') return tableRows(block, inlineText).map((row) => row.join('\t')).join('\n');
  return `[Unsupported block: ${rawType}]`;
}

export function blocksToMarkdown(blocks) {
  return sanitizeBlocks(blocks).map(markdownBlock).join('\n\n');
}

export function blocksToText(blocks) {
  return sanitizeBlocks(blocks).map(textBlock).join('\n\n');
}

export function normalizeDocument({ node, blocks } = {}) {
  const safeBlocks = sanitizeBlocks(blocks);
  const unsupportedBlockTypes = [];
  const supported = new Set([
    'paragraph', 'heading', 'unordered_list', 'bullet_list', 'ul', 'ordered_list',
    'numbered_list', 'ol', 'quote', 'blockquote', 'code_block', 'code', 'link', 'table',
  ]);
  for (const block of safeBlocks) {
    if (!supported.has(canonicalType(block))) {
      const type = blockType(block);
      if (!unsupportedBlockTypes.includes(type)) unsupportedBlockTypes.push(type);
    }
  }
  const safeNode = sanitizeValue(node);
  const normalizedNode = safeNode && !Array.isArray(safeNode) && typeof safeNode === 'object' ? safeNode : {};
  const contentType = [normalizedNode.contentType, normalizedNode.category, normalizedNode.fileType, normalizedNode.type]
    .find((value) => typeof value === 'string' && value.trim() !== '') ?? null;
  return {
    node: normalizedNode,
    contentType,
    markdown: safeBlocks.map(markdownBlock).join('\n\n'),
    text: safeBlocks.map(textBlock).join('\n\n'),
    blocks: safeBlocks,
    unsupportedBlockTypes,
    truncated: false,
  };
}
