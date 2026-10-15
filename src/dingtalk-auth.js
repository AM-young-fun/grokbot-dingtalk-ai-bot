import { ToolError } from './dingtalk-tool-error.js';

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const MAX_EXPIRY_SKEW_MS = 60_000;

function isAuthResponse(status, body) {
  if (status === 401 || status === 403) return true;

  const code = typeof body?.code === 'string' ? body.code : '';
  const normalizedCode = code.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const credentialCodes = new Set([
    'invalidauthentication',
    'authenticationfailed',
    'invalidcredential',
    'invalidcredentials',
    'invalidappkey',
    'invalidappsecret',
    'invalidaccesskey',
    'invalidaccesskeyid',
    'invalidclient',
    'invalidclientid',
    'invalidclientsecret',
  ]);
  if (credentialCodes.has(normalizedCode)) return true;

  const message = typeof body?.message === 'string' ? body.message : '';
  return status === 400
    && /(?:app.?key|app.?secret|access.?key|credential).*(?:invalid|not valid|reject)|(?:invalid|not valid|reject).*(?:app.?key|app.?secret|access.?key|credential)/i.test(message);
}

function safeError(code, message, status = 0) {
  return new ToolError(code, message, { status });
}

export function createTokenProvider({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 10_000,
}) {
  let cachedToken = null;
  let refreshAt = 0;
  let inFlight = null;

  async function requestToken() {
    const controller = new AbortController();
    let timer;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(safeError('UPSTREAM_TIMEOUT', 'DingTalk token request timed out'));
      }, timeoutMs);
    });

    let response;
    let body;
    try {
      const request = (async () => {
        try {
          response = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error?.name === 'AbortError' || controller.signal.aborted) {
            throw safeError('UPSTREAM_TIMEOUT', 'DingTalk token request timed out');
          }
          throw safeError('UPSTREAM_ERROR', 'DingTalk token request failed');
        }

        try {
          body = await response.json();
        } catch {
          throw safeError('UPSTREAM_ERROR', 'DingTalk token response was invalid', response.status);
        }
      })();

      await Promise.race([request, timeout]);
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw safeError('UPSTREAM_TIMEOUT', 'DingTalk token request timed out');
      }
      throw safeError('UPSTREAM_ERROR', 'DingTalk token request failed');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (isAuthResponse(response.status, body)) {
        throw safeError('AUTH_FAILED', 'DingTalk credentials were rejected', response.status);
      }
      throw safeError('UPSTREAM_ERROR', 'DingTalk token request failed', response.status);
    }

    if (isAuthResponse(response.status, body)) {
      throw safeError('AUTH_FAILED', 'DingTalk credentials were rejected', response.status);
    }

    const token = body?.accessToken;
    const expiresSeconds = body?.expireIn;
    if (typeof token !== 'string' || token.length === 0
      || typeof expiresSeconds !== 'number' || !Number.isFinite(expiresSeconds)
      || expiresSeconds <= 0) {
      throw safeError('UPSTREAM_ERROR', 'DingTalk token response was invalid', response.status);
    }

    const lifetimeMs = expiresSeconds * 1_000;
    const skewMs = Math.min(MAX_EXPIRY_SKEW_MS, lifetimeMs / 2);
    const issuedAt = now();
    const expiresAt = issuedAt + lifetimeMs;
    const nextRefreshAt = expiresAt - skewMs;
    if (![lifetimeMs, issuedAt, expiresAt, nextRefreshAt].every(Number.isFinite)) {
      throw safeError('UPSTREAM_ERROR', 'DingTalk token response was invalid', response.status);
    }

    cachedToken = token;
    refreshAt = nextRefreshAt;
    return token;
  }

  return {
    async getToken({ forceRefresh = false } = {}) {
      if (!forceRefresh && cachedToken !== null && now() < refreshAt) return cachedToken;
      if (inFlight !== null) return inFlight;

      inFlight = requestToken().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
