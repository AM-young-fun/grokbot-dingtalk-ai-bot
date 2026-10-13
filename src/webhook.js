export const WEBHOOK_TIMEOUT_MS = 10_000;

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
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : (error?.message ?? "network error");
    const err = new Error(`Grokbot webhook request failed: ${reason}`);
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`Grokbot webhook returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return { status: response.status };
}
