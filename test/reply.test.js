import test from "node:test";
import assert from "node:assert/strict";
import { buildTextReply, buildGroupReply, redactWebhook, sendAnswer } from "../src/reply.js";

const base = { msgtype: "text", text: { content: "B200 显存多大？" }, msgId: "msgA", senderId: "$:LWCP:abc", senderStaffId: "staff1", senderNick: "Gao", conversationId: "cidX", robotCode: "dingR", sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=secret" };

function fake(result = { errcode: 0 }) {
  const calls = [];
  return { calls, fetchImpl: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => result }; } };
}

test("single chat posts plain text to sessionWebhook, no @ or quote", async () => {
  const f = fake();
  await sendAnswer({ ...base, conversationType: "1" }, "answer", f);
  assert.equal(f.calls[0].url, base.sessionWebhook);
  assert.deepEqual(f.calls[0].body, buildTextReply("answer"));
});

test("group reply is markdown that quotes the question and @s senderStaffId", async () => {
  const f = fake();
  await sendAnswer({ ...base, conversationType: "2" }, "1.44 TB", f);
  const body = f.calls[0].body;
  assert.equal(body.msgtype, "markdown");
  assert.deepEqual(body.at.atUserIds, ["staff1"]);
  assert.match(body.markdown.text, /@staff1 1\.44 TB/);
  assert.match(body.markdown.text, /^> B200 显存多大？/);
});

test("group reply missing required fields errors, no plain fallback", async () => {
  const f = fake();
  await assert.rejects(sendAnswer({ ...base, conversationType: "2", senderStaffId: undefined }, "x", f), /senderStaffId.*refusing/);
  assert.equal(f.calls.length, 0);
  assert.throws(() => buildGroupReply({ ...base, robotCode: "" }, "x"), /robotCode/);
});

test("expired sessionWebhook and DingTalk errors reject", async () => {
  await assert.rejects(sendAnswer({ ...base, conversationType: "1", sessionWebhookExpiredTime: 1 }, "x", fake()), /expired/);
  await assert.rejects(sendAnswer({ ...base, conversationType: "1" }, "x", fake({ errcode: 300001, errmsg: "bad" })), /300001/);
});

test("redacts webhook query", () => {
  assert.equal(redactWebhook(base.sessionWebhook), "https://oapi.dingtalk.com/robot/sendBySession");
});
