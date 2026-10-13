import test from "node:test";
import assert from "node:assert/strict";
import { buildTextReply, redactWebhook, sendReply } from "../src/reply.js";

test("builds DingTalk text payload", () => {
  assert.deepEqual(buildTextReply("answer"), {
    msgtype: "text",
    text: { content: "answer" },
  });
});

test("rejects missing session webhook", async () => {
  await assert.rejects(() => sendReply("", "answer"), /sessionWebhook/);
});

test("posts text reply with access token and returns DingTalk result", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };

  const result = await sendReply(
    "https://oapi.dingtalk.com/robot/sendBySession?session=secret",
    "answer",
    { accessToken: "token", fetchImpl: fakeFetch },
  );

  assert.deepEqual(result, { errcode: 0 });
  assert.equal(calls[0].options.headers["x-acs-dingtalk-access-token"], "token");
  assert.deepEqual(JSON.parse(calls[0].options.body), buildTextReply("answer"));
});

test("rejects DingTalk API errors", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ errcode: 300001, errmsg: "session 不存在" }),
  });

  await assert.rejects(
    () => sendReply(
      "https://oapi.dingtalk.com/robot/sendBySession?session=secret",
      "answer",
      { fetchImpl: fakeFetch },
    ),
    /300001: session 不存在/,
  );
});

test("redacts session value", () => {
  assert.equal(
    redactWebhook("https://oapi.dingtalk.com/robot/sendBySession?session=secret"),
    "https://oapi.dingtalk.com/robot/sendBySession?session=%5BREDACTED%5D",
  );
});
