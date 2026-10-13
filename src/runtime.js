import { shouldHandleMessage } from "./message.js";
import { forwardToGrokbot } from "./webhook.js";
import { createMessageGuard } from "./guard.js";

// Stream callback: filter -> forward raw data to Grokbot -> ACK success only after 2xx.
// No interim text reply. Optional best-effort reaction (silent on failure).
export function createRobotCallbackHandler({
  client,
  config,
  forward = forwardToGrokbot,
  react,
  fetchImpl,
  logger = console,
  guard = createMessageGuard(),
}) {
  return async function onRobotCallback(callback) {
    const messageId = callback?.headers?.messageId;
    let data;
    try {
      data = typeof callback.data === "string" ? JSON.parse(callback.data) : callback.data;
    } catch (error) {
      logger.error("DingTalk callback parse failed", { messageId, error: error.message });
      client.socketCallBackResponse(messageId, { success: false });
      return;
    }

    if (!shouldHandleMessage(data)) {
      client.socketCallBackResponse(messageId, { success: true, handled: false });
      return;
    }

    if (!data?.msgId) {
      logger.error("DingTalk message missing msgId", { code: "MESSAGE_ID_MISSING" });
      client.socketCallBackResponse(messageId, { success: false });
      return;
    }

    const decision = guard.begin(data);
    if (decision.action === "limited") {
      logger.error("DingTalk message rate limited", { msgId: data.msgId, code: "MESSAGE_RATE_LIMITED" });
      client.socketCallBackResponse(messageId, { success: true, handled: false, limited: true });
      return;
    }
    if (decision.action === "duplicate") {
      const accepted = await decision.wait;
      client.socketCallBackResponse(messageId, accepted
        ? { success: true, handled: true, duplicate: true }
        : { success: false });
      return;
    }

    try {
      await forward(data, { url: config.webhookUrl, secret: config.webhookSecret, fetchImpl });
    } catch (error) {
      guard.fail(data.msgId);
      logger.error("Grokbot webhook not accepted", {
        msgId: data?.msgId,
        status: error.status ?? 0,
        code: error.code ?? "WEBHOOK_UNKNOWN",
      });
      client.socketCallBackResponse(messageId, { success: false });
      return;
    }

    guard.succeed(data.msgId);
    client.socketCallBackResponse(messageId, { success: true, handled: true });
    if (react) {
      try { await react(data); } catch { /* best effort, silent */ }
    }
  };
}
