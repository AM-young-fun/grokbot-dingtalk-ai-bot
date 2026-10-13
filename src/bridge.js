import { shouldHandleMessage } from "./message.js";

const FAILURE_REPLY = "处理失败，请稍后重试";

export async function processDingTalkMessage(data, deps) {
  if (!shouldHandleMessage(data)) {
    return { handled: false, reason: "ignored" };
  }

  const logger = deps.logger ?? console;

  try {
    const answer = await deps.handleMessage(data);
    const content = typeof answer === "string" && answer.trim()
      ? answer.trim()
      : FAILURE_REPLY;
    await deps.send(data.sessionWebhook, content);
    return { handled: true, fallback: content === FAILURE_REPLY };
  } catch (error) {
    logger.error("Grokbot message processing failed", {
      msgId: data.msgId,
      error: error.message,
    });
    await deps.send(data.sessionWebhook, FAILURE_REPLY);
    return { handled: true, fallback: true };
  }
}
