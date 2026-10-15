import { ToolError } from './dingtalk-tool-error.js';

const API_ORIGIN = 'https://api.dingtalk.com';

function safeError(code, message, status = 0) {
  return new ToolError(code, message, { status });
}

export function createOperatorIdProvider({
  operatorId,
  operatorUserId,
  tokenProvider,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  const directId = operatorId?.trim() ?? '';
  const userId = operatorUserId?.trim() ?? '';
  if (!directId && !userId) throw safeError('INVALID_ARGUMENT', 'An operator identity is required');
  if (!directId && (!tokenProvider || typeof tokenProvider.getToken !== 'function')) {
    throw safeError('INVALID_ARGUMENT', 'tokenProvider.getToken is required');
  }

  let cachedId = directId || null;
  let inFlight = null;

  async function resolve() {
    let token;
    try {
      token = await tokenProvider.getToken();
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw safeError('UPSTREAM_ERROR', 'DingTalk token provider failed');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(
        `${API_ORIGIN}/v1.0/contact/users/${encodeURIComponent(userId)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw safeError('UPSTREAM_TIMEOUT', 'DingTalk operator lookup timed out');
      }
      throw safeError('UPSTREAM_ERROR', 'DingTalk operator lookup failed');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) throw safeError('AUTH_FAILED', 'DingTalk authentication failed', 401);
    if (response.status === 403) throw safeError('DOCUMENT_FORBIDDEN', 'DingTalk operator lookup forbidden', 403);
    if (response.status === 404) throw safeError('NOT_FOUND', 'DingTalk operator was not found', 404);
    if (!response.ok) throw safeError('UPSTREAM_ERROR', 'DingTalk operator lookup failed', response.status);

    let body;
    try {
      body = await response.json();
    } catch {
      throw safeError('UPSTREAM_ERROR', 'DingTalk operator response was invalid', response.status);
    }
    if (typeof body?.unionId !== 'string' || body.unionId.trim() === '') {
      throw safeError('OPERATOR_RESOLUTION_FAILED', 'DingTalk operator response lacked unionId', response.status);
    }
    cachedId = body.unionId.trim();
    return cachedId;
  }

  return {
    async getOperatorId() {
      if (cachedId !== null) return cachedId;
      if (inFlight === null) {
        inFlight = resolve().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
