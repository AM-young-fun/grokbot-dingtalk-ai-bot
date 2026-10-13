import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, resolveWebhookSecret } from "../src/config.js";

const full = { DINGTALK_CLIENT_ID: "id", DINGTALK_CLIENT_SECRET: "sec", GROKBOT_WEBHOOK_URL: "https://hook.test/x", GROKBOT_WEBHOOK_SECRET: "s1" };

test("loadConfig returns all values", () => {
  assert.deepEqual(loadConfig(full), { clientId: "id", clientSecret: "sec", webhookUrl: "https://hook.test/x", webhookSecret: "s1" });
});

test("missing config refuses to start and names every variable", () => {
  assert.throws(() => loadConfig({}), /DINGTALK_CLIENT_ID, DINGTALK_CLIENT_SECRET, GROKBOT_WEBHOOK_URL, GROKBOT_WEBHOOK_SECRET/);
});

test("secret falls back to GROKBOT_WEBHOOK_AUTH with prefixes stripped", () => {
  assert.equal(resolveWebhookSecret({ GROKBOT_WEBHOOK_AUTH: "Authorization: Bearer abc" }), "abc");
  assert.equal(resolveWebhookSecret({ GROKBOT_WEBHOOK_AUTH: "bearer abc" }), "abc");
  assert.equal(resolveWebhookSecret({ GROKBOT_WEBHOOK_AUTH: "abc" }), "abc");
  assert.equal(resolveWebhookSecret({ GROKBOT_WEBHOOK_SECRET: "x", GROKBOT_WEBHOOK_AUTH: "Bearer y" }), "x");
});

test("Grokbot webhook must be HTTPS without embedded credentials", () => {
  for (const webhookUrl of [
    "http://hook.test/x",
    "not a URL",
    "https://user:pass@hook.test/x",
  ]) {
    assert.throws(
      () => loadConfig({ ...full, GROKBOT_WEBHOOK_URL: webhookUrl }),
      /Invalid GROKBOT_WEBHOOK_URL/,
    );
  }
});
