import test from "node:test";
import assert from "node:assert/strict";
import { getMessageText, shouldHandleMessage } from "../src/message.js";

test("accepts group text when robot is mentioned", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "2",
    isInAtList: true,
    msgtype: "text",
    text: { content: " hello " },
  }), true);
});

test("ignores group text without robot mention", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "2",
    isInAtList: false,
    msgtype: "text",
    text: { content: "hello" },
  }), false);
});

test("accepts private text", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "1",
    msgtype: "text",
    text: { content: "hello" },
  }), true);
});

test("ignores non-text and blank text", () => {
  assert.equal(shouldHandleMessage({ conversationType: "1", msgtype: "picture" }), false);
  assert.equal(shouldHandleMessage({
    conversationType: "1",
    msgtype: "text",
    text: { content: "   " },
  }), false);
});

test("trims text without changing original data", () => {
  const data = { text: { content: " hello " } };
  assert.equal(getMessageText(data), "hello");
  assert.equal(data.text.content, " hello ");
});
