import { shouldHandleMessage } from "./message.js";
import { forwardToGrokbot } from "./webhook.js";

// Stream callback: filter -> forward raw data to Grokbot -> ACK success only after 2xx.
// No interim text reply. Optional best-effort reaction (silent on failure).
export function createRobotCallbackHandler({ client, config, forward = forwardToGrokbot, react, fetchImpl, logger = console }) {
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

    try {
      await forward(data, { url: config.webhookUrl, secret: config.webhookSecret, fetchImpl });
    } catch (error) {
      logger.error("Grokbot webhook not accepted", {
        msgId: data?.msgId,
        status: error.status ?? 0,
        code: error.code ?? "WEBHOOK_UNKNOWN",
      });
      client.socketCallBackResponse(messageId, { success: false });
      return;
    }

    client.socketCallBackResponse(messageId, { success: true, handled: true });
    if (react) {
      try { await react(data); } catch { /* best effort, silent */ }
    }
  };
}
