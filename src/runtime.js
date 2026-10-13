import { processDingTalkMessage } from "./bridge.js";

export function createRobotCallbackHandler({ client, handleMessage, send, logger = console }) {
  return async function onRobotCallback(callback) {
    const messageId = callback?.headers?.messageId;

    try {
      const data = typeof callback.data === "string"
        ? JSON.parse(callback.data)
        : callback.data;
      const result = await processDingTalkMessage(data, {
        handleMessage,
        logger,
        send: async (webhook, content) => {
          const accessToken = await client.getAccessToken();
          return send(webhook, content, { accessToken });
        },
      });
      client.socketCallBackResponse(messageId, { success: true, ...result });
    } catch (error) {
      logger.error("DingTalk callback failed", {
        messageId,
        error: error.message,
      });
      client.socketCallBackResponse(messageId, { success: false });
    }
  };
}
