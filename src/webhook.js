export const WEBHOOK_TIMEOUT_MS = 10_000;

function webhookError(code, status = 0) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

// POST the raw DingTalk `data` (no wrapper) to the Grokbot webhook. Resolves on 2xx, throws otherwise.
export async function forwardToGrokbot(data, { url, secret, fetchImpl = fetch, timeoutMs = WEBHOOK_TIMEOUT_MS }) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => { const e = new Error("timeout"); e.name = "TimeoutError"; controller.abort(e); }, timeoutMs);
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
  } catch (error) {
    const code = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "WEBHOOK_TIMEOUT"
      : "WEBHOOK_NETWORK";
    throw webhookError(code);
  } finally {
    clearTimeout(timer);
  }
  if (response.status < 200 || response.status >= 300) {
    throw webhookError("WEBHOOK_HTTP", response.status);
  }
  return { status: response.status };
}
