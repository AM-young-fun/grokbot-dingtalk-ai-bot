const SAFE_FIELDS = new Set([
  'id', 'index', 'type', 'kind', 'text', 'content', 'children', 'element', 'elements', 'items',
  'rows', 'cells', 'url', 'title', 'language', 'level', 'name', 'value', 'contentType',
  'docKey', 'nodeId', 'workspaceId', 'parentNodeId',
]);
const SECRET_KEY = /token|secret|authorization|credential|cookie|webhook|app[_-]?secret/i;

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object') return undefined;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || !SAFE_FIELDS.has(key)) continue;
    const safeChild = sanitizeValue(child);
    if (safeChild !== undefined) output[key] = safeChild;
  }
  return output;
}

export function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(sanitizeValue);
}

function blockType(block) {
  if (!block || typeof block !== 'object') return 'unknown';
  const value = typeof block.type === 'string' && block.type.trim()
    ? block.type : block.kind;
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
  if (!value || typeof value !== 'object') return plain(value);
  if (canonicalType(value) === 'link' || value.url !== undefined) {
    const label = plain(value.text ?? value.title ?? value.content) || plain(value.url);
    const url = safeMarkdownUrl(value.url);
    return url ? `[${label.replace(/([\[\]])/g, '\\$1')}](${url})` : label;
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
  return block?.content ?? block?.children ?? block?.elements ?? block?.element ?? block?.text ?? block?.value ?? '';
}

function listItems(block) {
  return Array.isArray(block?.items) ? block.items
    : Array.isArray(block?.children) ? block.children : [];
}

function tableRows(block, renderCell) {
  if (!Array.isArray(block?.rows)) return [];
  return block.rows.map((row) => {
    const cells = Array.isArray(row) ? row : Array.isArray(row?.cells) ? row.cells : [];
    return cells.map(renderCell);
  });
}

function markdownBlock(block) {
  const rawType = blockType(block);
  const type = canonicalType(block);
  if (type === 'paragraph') return inlineMarkdown(contentOf(block));
  if (type === 'heading') {
    const level = Number.isInteger(block?.level) ? Math.min(6, Math.max(1, block.level)) : 1;
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
    const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map(([ticks]) => ticks.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const language = typeof block?.language === 'string' ? block.language.replace(/[^\w.+-]/g, '') : '';
    return `${fence}${language}\n${code}\n${fence}`;
  }
  if (type === 'link') return inlineMarkdown(block);
  if (type === 'table') {
    const rows = tableRows(block, (cell) => inlineMarkdown(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br>'));
    if (!rows.length) return '';
    const width = Math.max(1, ...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
    return [normalized[0], Array(width).fill('---'), ...normalized.slice(1)]
      .map((row) => `| ${row.join(' | ')} |`).join('\n');
  }
  return `[Unsupported block: ${rawType}]`;
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
  if (type === 'link') return inlineText(block);
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
  return {
    node: normalizedNode,
    contentType: normalizedNode.contentType ?? normalizedNode.type ?? null,
    markdown: safeBlocks.map(markdownBlock).join('\n\n'),
    text: safeBlocks.map(textBlock).join('\n\n'),
    blocks: safeBlocks,
    unsupportedBlockTypes,
    truncated: false,
  };
}
