import test from "node:test";
import assert from "node:assert/strict";
import { processDingTalkMessage } from "../src/bridge.js";

const message = {
  conversationType: "1",
  msgtype: "text",
  text: { content: "question" },
  msgId: "msg-1",
  sessionWebhook: "https://example.test/session",
};

test("passes unchanged DingTalk data to Grokbot and replies once", async () => {
  const seen = [];
  const replies = [];
  const result = await processDingTalkMessage(message, {
    handleMessage: async (data) => {
      seen.push(data);
      return "answer";
    },
    send: async (...args) => {
      replies.push(args);
      return { errcode: 0 };
    },
  });

  assert.equal(seen[0], message);
  assert.deepEqual(replies, [[message.sessionWebhook, "answer"]]);
  assert.equal(result.handled, true);
});

test("does nothing for ignored messages", async () => {
  let called = false;
  const result = await processDingTalkMessage({ ...message, msgtype: "picture" }, {
    handleMessage: async () => { called = true; },
    send: async () => { called = true; },
  });

  assert.equal(called, false);
  assert.deepEqual(result, { handled: false, reason: "ignored" });
});

test("uses failure message when Grokbot throws", async () => {
  const replies = [];
  const result = await processDingTalkMessage(message, {
    handleMessage: async () => { throw new Error("model unavailable"); },
    send: async (...args) => {
      replies.push(args);
      return { errcode: 0 };
    },
    logger: { error() {} },
  });

  assert.deepEqual(replies, [[message.sessionWebhook, "处理失败，请稍后重试"]]);
  assert.equal(result.handled, true);
  assert.equal(result.fallback, true);
});

test("uses failure message for blank Grokbot output", async () => {
  const replies = [];
  await processDingTalkMessage(message, {
    handleMessage: async () => "   ",
    send: async (...args) => {
      replies.push(args);
      return { errcode: 0 };
    },
  });

  assert.deepEqual(replies, [[message.sessionWebhook, "处理失败，请稍后重试"]]);
});
