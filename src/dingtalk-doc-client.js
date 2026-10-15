import { ToolError } from './dingtalk-tool-error.js';

const API_ORIGIN = 'https://api.dingtalk.com';
const SAFE_DOC_HOSTS = new Set(['alidocs.dingtalk.com', 'docs.dingtalk.com']);
const SENSITIVE_URL_KEY = /token|secret|access_token|authorization|credential|code|signature|sign|ticket|auth|session|webhook/i;

function invalid(message) {
  return new ToolError('INVALID_ARGUMENT', message);
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${name} must be a non-empty string`);
  return value;
}

function validateMaxResults(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw invalid('maxResults must be an integer from 1 to 100');
  }
}

function validateOptionalToken(value) {
  if (value !== undefined) requireText(value, 'nextToken');
}

function validateDocumentUrl(value) {
  requireText(value, 'url');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid('url must be a valid DingTalk document URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || !SAFE_DOC_HOSTS.has(parsed.hostname) || (parsed.port && parsed.port !== '443')) {
    throw invalid('url must be a safe DingTalk document URL');
  }
  if (parsed.hash || [...parsed.searchParams.keys()].some((key) => SENSITIVE_URL_KEY.test(key))) {
    throw invalid('url must be a safe DingTalk document URL');
  }
  return value;
}

function statusError(response) {
  const definitions = {
    400: ['INVALID_ARGUMENT', 'DingTalk rejected request arguments'],
    401: ['AUTH_FAILED', 'DingTalk authentication failed'],
    403: ['DOCUMENT_FORBIDDEN', 'DingTalk document access forbidden'],
    404: ['NOT_FOUND', 'DingTalk resource not found'],
    429: ['RATE_LIMITED', 'DingTalk rate limit reached'],
  };
  const [code, message] = definitions[response.status] ?? ['UPSTREAM_ERROR', 'DingTalk request failed'];
  return new ToolError(code, message, {
    status: response.status,
    retryAfter: response.status === 429 ? response.headers?.get?.('retry-after') ?? null : null,
  });
}

function normalizePage(payload, collectionKey) {
  const data = Array.isArray(payload) ? payload
    : payload?.data ?? payload?.[collectionKey] ?? [];
  const nextToken = Array.isArray(payload) ? null : payload?.nextToken || null;
  return { data, page: { nextCursor: nextToken, hasMore: Boolean(nextToken) } };
}

function cancelResponseBody(response) {
  try {
    const cancellation = response.body?.cancel?.();
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {});
    }
  } catch {
    // Body disposal is best-effort and must never mask the request result.
  }
}

async function readBoundedBody(response, maxResponseBytes, timeout) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await Promise.race([response.arrayBuffer(), timeout]));
    if (bytes.byteLength > maxResponseBytes) {
      throw new ToolError('UPSTREAM_ERROR', 'DingTalk response exceeded size limit');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      length += chunk.byteLength;
      if (length > maxResponseBytes) {
        void reader.cancel().catch(() => {});
        throw new ToolError('UPSTREAM_ERROR', 'DingTalk response exceeded size limit');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!(error instanceof ToolError && error.code === 'UPSTREAM_ERROR')) {
      void reader.cancel().catch(() => {});
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createDingTalkDocClient({
  tokenProvider,
  operatorId,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  maxResponseBytes = 5 * 1024 * 1024,
}) {
  requireText(operatorId, 'operatorId');
  if (!tokenProvider || typeof tokenProvider.getToken !== 'function') throw invalid('tokenProvider.getToken is required');
  if (typeof fetchImpl !== 'function') throw invalid('fetchImpl must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw invalid('timeoutMs must be positive');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) throw invalid('maxResponseBytes must be a positive integer');

  async function request(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let token;
      try {
        token = await tokenProvider.getToken(attempt === 1 ? { forceRefresh: true } : undefined);
      } catch (error) {
        if (error instanceof ToolError) throw error;
        throw new ToolError('UPSTREAM_ERROR', 'DingTalk token provider failed');
      }
      const controller = new AbortController();
      let timedOut = false;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ToolError('UPSTREAM_TIMEOUT', 'DingTalk request timed out'));
        }, timeoutMs);
      });
      try {
        const headers = {
          accept: 'application/json',
          'x-acs-dingtalk-access-token': token,
        };
        const init = { method, headers, signal: controller.signal };
        if (body !== undefined) {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        const response = await Promise.race([fetchImpl(url.toString(), init), timeout]);
        if (response.status === 401 && attempt === 0) {
          cancelResponseBody(response);
          clearTimeout(timer);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          cancelResponseBody(response);
          throw statusError(response);
        }

        const declaredLength = response.headers?.get?.('content-length');
        if (declaredLength !== null && declaredLength !== undefined
            && Number(declaredLength) > maxResponseBytes) {
          cancelResponseBody(response);
          throw new ToolError('UPSTREAM_ERROR', 'DingTalk response exceeded size limit');
        }
        const bytes = await readBoundedBody(response, maxResponseBytes, timeout);
        try {
          return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new ToolError('UPSTREAM_ERROR', 'DingTalk returned malformed JSON');
        }
      } catch (error) {
        if (error instanceof ToolError) throw error;
        if (timedOut) throw new ToolError('UPSTREAM_TIMEOUT', 'DingTalk request timed out');
        throw new ToolError('UPSTREAM_ERROR', 'DingTalk request failed');
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ToolError('AUTH_FAILED', 'DingTalk authentication failed', { status: 401 });
  }

  return {
    async health() {
      await request('/v2.0/wiki/workspaces', { query: { operatorId, maxResults: 1 } });
      return { authenticated: true, operatorIdConfigured: true, dingTalkReachable: true };
    },

    async listWorkspaces({ maxResults = 20, nextToken } = {}) {
      validateMaxResults(maxResults);
      validateOptionalToken(nextToken);
      const payload = await request('/v2.0/wiki/workspaces', {
        query: { operatorId, maxResults, nextToken },
      });
      return normalizePage(payload, 'workspaces');
    },

    async getWorkspace(workspaceId) {
      requireText(workspaceId, 'workspaceId');
      return request(`/v2.0/wiki/workspaces/${encodeURIComponent(workspaceId)}`, { query: { operatorId } });
    },

    async listNodes({ workspaceId, parentNodeId, maxResults = 50, nextToken } = {}) {
      requireText(workspaceId, 'workspaceId');
      if (parentNodeId !== undefined) requireText(parentNodeId, 'parentNodeId');
      validateMaxResults(maxResults);
      validateOptionalToken(nextToken);
      const payload = await request('/v2.0/wiki/nodes', {
        query: { workspaceId, parentNodeId, operatorId, maxResults, nextToken },
      });
      return normalizePage(payload, 'nodes');
    },

    async getNode(nodeId) {
      requireText(nodeId, 'nodeId');
      return request(`/v2.0/wiki/nodes/${encodeURIComponent(nodeId)}`, { query: { operatorId } });
    },

    async resolveUrl(url) {
      validateDocumentUrl(url);
      return request('/v2.0/wiki/nodes/queryByUrl', {
        method: 'POST',
        query: { operatorId },
        body: { url, operatorId },
      });
    },

    async getBlocks(docKey) {
      requireText(docKey, 'docKey');
      return request(`/v1.0/doc/suites/documents/${encodeURIComponent(docKey)}/blocks`, { query: { operatorId } });
    },
  };
}
