import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig returns DingTalk credentials", () => {
  assert.deepEqual(loadConfig({
    DINGTALK_CLIENT_ID: "client-id",
    DINGTALK_CLIENT_SECRET: "client-secret",
  }), {
    clientId: "client-id",
    clientSecret: "client-secret",
  });
});

test("loadConfig reports every missing credential", () => {
  assert.throws(
    () => loadConfig({}),
    /DINGTALK_CLIENT_ID, DINGTALK_CLIENT_SECRET/,
  );
});
