import test from "node:test";
import assert from "node:assert/strict";
import { createRobotCallbackHandler } from "../src/runtime.js";

const data = {
  conversationType: "1",
  msgtype: "text",
  text: { content: "question" },
  msgId: "msg-1",
  sessionWebhook: "https://example.test/session",
};

test("parses callback data, replies, and acknowledges success", async () => {
  const acknowledgements = [];
  const sends = [];
  const client = {
    getAccessToken: async () => "access-token",
    socketCallBackResponse: (...args) => acknowledgements.push(args),
  };
  const handler = createRobotCallbackHandler({
    client,
    handleMessage: async (received) => {
      assert.deepEqual(received, data);
      return "answer";
    },
    send: async (...args) => {
      sends.push(args);
      return { errcode: 0 };
    },
  });

  await handler({ headers: { messageId: "callback-1" }, data: JSON.stringify(data) });

  assert.deepEqual(sends, [[data.sessionWebhook, "answer", { accessToken: "access-token" }]]);
  assert.deepEqual(acknowledgements, [["callback-1", {
    success: true,
    handled: true,
    fallback: false,
  }]]);
});

test("acknowledges malformed callback as failure", async () => {
  const acknowledgements = [];
  const errors = [];
  const handler = createRobotCallbackHandler({
    client: {
      socketCallBackResponse: (...args) => acknowledgements.push(args),
    },
    handleMessage: async () => "unused",
    send: async () => ({ errcode: 0 }),
    logger: { error: (...args) => errors.push(args) },
  });

  await handler({ headers: { messageId: "callback-2" }, data: "{" });

  assert.equal(errors.length, 1);
  assert.deepEqual(acknowledgements, [["callback-2", { success: false }]]);
});
