export function buildTextReply(content) {
  return {
    msgtype: "text",
    text: { content: String(content) },
  };
}

export function redactWebhook(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.searchParams.has("session")) {
      url.searchParams.set("session", "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[INVALID WEBHOOK]";
  }
}

export async function sendReply(sessionWebhook, content, options = {}) {
  if (!sessionWebhook) throw new Error("Missing sessionWebhook");

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (options.accessToken) {
    headers["x-acs-dingtalk-access-token"] = options.accessToken;
  }

  const response = await fetchImpl(sessionWebhook, {
    method: "POST",
    headers,
    body: JSON.stringify(buildTextReply(content)),
  });
  const result = await response.json();

  if (!response.ok || (result.errcode !== undefined && result.errcode !== 0)) {
    throw new Error(
      `DingTalk reply failed (${response.status}) ${result.errcode ?? "HTTP"}: ${result.errmsg ?? "unknown error"}`,
    );
  }

  return result;
}
