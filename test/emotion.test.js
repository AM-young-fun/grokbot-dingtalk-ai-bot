import test from "node:test";
import assert from "node:assert/strict";
import { emotion } from "../src/emotion.js";

const data = { robotCode: "r", msgId: "m", conversationId: "c" };
const creds = { clientId: "id", clientSecret: "s" };

test("reply/recall hit the emotion endpoints with msg ids", async () => {
  const urls = [];
  const fetchImpl = async (url, o) => { urls.push([url, JSON.parse(o.body)]); return { ok: true, status: 200, json: async () => ({ accessToken: "t" }) }; };
  assert.equal(await emotion("recall", data, { ...creds, fetchImpl }), true);
  assert.match(urls[1][0], /\/v1\.0\/robot\/emotion\/recall$/);
  assert.equal(urls[1][1].openMsgId, "m");
  assert.equal(urls[1][1].emotionName, "👌");
});

test("emotion failures are silent", async () => {
  assert.equal(await emotion("reply", data, { ...creds, fetchImpl: async () => { throw new Error("x"); } }), false);
  assert.equal(await emotion("reply", {}, creds), false);
});
