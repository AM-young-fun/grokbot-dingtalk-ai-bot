#!/usr/bin/env node
// Reply helper used by Grokbot to deliver the final answer.
// Usage: node src/reply.js <payload.json> <answer.txt>
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { emotion } from "./emotion.js";

export function buildTextReply(content) {
  return { msgtype: "text", text: { content: String(content) } };
}

// Group reply: Markdown that @s the asker (atUserIds + "@userId" mark in text) and
// quotes the original question as a Markdown blockquote. Native DingTalk quote
// (openMessageId/openDingTalkId) is not exposed by any official robot send API.
export function buildGroupReply(data, answer) {
  const missing = ["sessionWebhook", "senderStaffId", "msgId", "senderId", "conversationId", "robotCode"]
    .filter((k) => !data?.[k]);
  if (missing.length) {
    throw new Error(`Group reply missing required fields: ${missing.join(", ")}; refusing to send a plain message`);
  }
  const question = String(data.text?.content ?? "").trim();
  const quoted = question.split("\n").map((l) => `> ${l}`).join("\n");
  const asker = data.senderNick ? `${data.senderNick}` : "";
  const text = `${quoted ? `${quoted}${asker ? `\n>\n> —— ${asker}` : ""}\n\n` : ""}@${data.senderStaffId} ${String(answer)}`;
  return {
    msgtype: "markdown",
    markdown: { title: question.slice(0, 20) || "回复", text },
    at: { atUserIds: [data.senderStaffId], isAtAll: false },
  };
}

export function redactWebhook(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[INVALID WEBHOOK]";
  }
}

export function validateSessionWebhook(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error("Invalid DingTalk sessionWebhook");
    error.code = "INVALID_SESSION_WEBHOOK";
    throw error;
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "oapi.dingtalk.com"
    || (url.port && url.port !== "443")
    || url.pathname !== "/robot/sendBySession"
    || url.username
    || url.password
  ) {
    const error = new Error("Invalid DingTalk sessionWebhook");
    error.code = "INVALID_SESSION_WEBHOOK";
    throw error;
  }
  return url.toString();
}

async function postSession(sessionWebhook, body, fetchImpl) {
  const response = await fetchImpl(sessionWebhook, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  let result = {};
  try { result = await response.json(); } catch { /* empty */ }
  if (!response.ok || (result.errcode !== undefined && result.errcode !== 0)) {
    throw new Error(`DingTalk reply failed (${response.status}) ${result.errcode ?? "HTTP"}: ${result.errmsg ?? "unknown error"}`);
  }
  return result;
}

export async function sendAnswer(data, answer, { fetchImpl = fetch, now = Date.now } = {}) {
  const content = String(answer ?? "").trim();
  if (!content) throw new Error("Answer is empty");
  if (!data?.sessionWebhook) throw new Error("Missing sessionWebhook");
  if (data.sessionWebhookExpiredTime && Number(data.sessionWebhookExpiredTime) < now()) {
    throw new Error("sessionWebhook expired");
  }
  const sessionWebhook = validateSessionWebhook(data.sessionWebhook);
  if (data.conversationType === "1") return postSession(sessionWebhook, buildTextReply(content), fetchImpl);
  if (data.conversationType === "2") return postSession(sessionWebhook, buildGroupReply(data, content), fetchImpl);
  throw new Error(`Unsupported conversationType: ${data.conversationType}`);
}

async function main(argv) {
  const [payloadPath, answerPath] = argv;
  if (!payloadPath || !answerPath) {
    console.error("Usage: node src/reply.js <payload.json> <answer.txt>");
    return 2;
  }
  try {
    const data = JSON.parse(await readFile(payloadPath, "utf8"));
    const answer = await readFile(answerPath, "utf8");
    await sendAnswer(data, answer);
    // Best-effort: remove the 👌 reaction the bridge added (silent on failure).
    await emotion("recall", data, {
      clientId: process.env.DINGTALK_CLIENT_ID?.trim(),
      clientSecret: process.env.DINGTALK_CLIENT_SECRET?.trim(),
    });
    console.log(`Reply sent (conversationType=${data.conversationType}, msgId=${data.msgId ?? "?"})`);
    return 0;
  } catch (error) {
    console.error(`Reply failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
