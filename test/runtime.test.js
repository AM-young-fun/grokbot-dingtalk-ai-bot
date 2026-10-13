import test from "node:test";
import assert from "node:assert/strict";
import { createRobotCallbackHandler } from "../src/runtime.js";
import { forwardToGrokbot } from "../src/webhook.js";

const config = { webhookUrl: "https://hook.test/w", webhookSecret: "sek" };
const single = { conversationType: "1", msgtype: "text", text: { content: "q" }, msgId: "m1", sessionWebhook: "https://s.test" };
const group = { ...single, conversationType: "2", isInAtList: true };

function setup({ status = 200, throwErr, react } = {}) {
  const acks = [], calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (throwErr) throw throwErr;
    return { status };
  };
  const handler = createRobotCallbackHandler({
    client: { socketCallBackResponse: (...a) => acks.push(a) },
    config, fetchImpl, react, logger: { error() {} },
  });
  return { acks, calls, handler };
}

function setupWithLogger({ status = 200, throwErr } = {}) {
  const acks = [], calls = [], errors = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (throwErr) throw throwErr;
    return { status };
  };
  const handler = createRobotCallbackHandler({
    client: { socketCallBackResponse: (...a) => acks.push(a) },
    config,
    fetchImpl,
    logger: { error: (...args) => errors.push(args) },
  });
  return { acks, calls, errors, handler };
}

test("group text mentioning the robot triggers webhook once", async () => {
  const { calls, acks, handler } = setup();
  await handler({ headers: { messageId: "c" }, data: JSON.stringify(group) });
  assert.equal(calls.length, 1);
  assert.deepEqual(acks, [["c", { success: true, handled: true }]]);
});

test("group text without mention is ignored", async () => {
  const { calls, handler } = setup();
  await handler({ headers: { messageId: "c" }, data: JSON.stringify({ ...group, isInAtList: false }) });
  assert.equal(calls.length, 0);
});

test("single chat text triggers webhook with raw data body and Bearer secret", async () => {
  const { calls, handler } = setup();
  await handler({ headers: { messageId: "c" }, data: JSON.stringify(single) });
  assert.equal(calls[0].url, config.webhookUrl);
  assert.deepEqual(JSON.parse(calls[0].opts.body), single);
  assert.equal(calls[0].opts.headers.authorization, "Bearer sek");
  assert.equal(calls[0].opts.method, "POST");
});

test("non-text and empty text are ignored", async () => {
  const { calls, handler } = setup();
  await handler({ headers: { messageId: "a" }, data: { ...single, msgtype: "picture" } });
  await handler({ headers: { messageId: "b" }, data: { ...single, text: { content: "  " } } });
  assert.equal(calls.length, 0);
});

test("non-2xx gives failure ACK", async () => {
  const { acks, handler } = setup({ status: 500 });
  await handler({ headers: { messageId: "c" }, data: single });
  assert.deepEqual(acks, [["c", { success: false }]]);
});

test("network error/timeout gives failure ACK", async () => {
  const err = new Error("t"); err.name = "TimeoutError";
  const { acks, handler } = setup({ throwErr: err });
  await handler({ headers: { messageId: "c" }, data: single });
  assert.deepEqual(acks, [["c", { success: false }]]);
});

test("webhook times out after the configured limit", async () => {
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason)));
  await assert.rejects(
    forwardToGrokbot(single, { url: "https://hook.test/secret", secret: "s", fetchImpl: hang, timeoutMs: 20 }),
    (error) => error.code === "WEBHOOK_TIMEOUT" && !error.message.includes("hook.test"),
  );
});

test("network errors and runtime logs omit raw secret details", async () => {
  const secretText = "https://hook.test/path?token=leaked Bearer leaked";
  const { errors, handler } = setupWithLogger({ throwErr: new Error(secretText) });
  await handler({ headers: { messageId: "c" }, data: single });
  const output = JSON.stringify(errors);
  assert.match(output, /WEBHOOK_NETWORK/);
  assert.doesNotMatch(output, /leaked|hook\.test|Bearer/);
});

test("HTTP webhook errors expose only code and status", async () => {
  const { errors, handler } = setupWithLogger({ status: 503 });
  await handler({ headers: { messageId: "c" }, data: single });
  assert.deepEqual(errors, [["Grokbot webhook not accepted", {
    msgId: "m1",
    status: 503,
    code: "WEBHOOK_HTTP",
  }]]);
});

test("no interim text is sent; failing reaction does not affect ACK", async () => {
  const { calls, acks, handler } = setup({ react: async () => { throw new Error("nope"); } });
  await handler({ headers: { messageId: "c" }, data: single });
  assert.equal(calls.length, 1); // only the webhook, nothing to sessionWebhook
  assert.ok(calls.every((c) => c.url !== single.sessionWebhook));
  assert.deepEqual(acks, [["c", { success: true, handled: true }]]);
});

test("malformed callback ACKs failure", async () => {
  const { acks, handler } = setup();
  await handler({ headers: { messageId: "c" }, data: "{" });
  assert.deepEqual(acks, [["c", { success: false }]]);
});
