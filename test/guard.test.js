import test from "node:test";
import assert from "node:assert/strict";
import { createMessageGuard } from "../src/guard.js";

const message = (msgId, senderId = "sender-1") => ({ msgId, senderId });

test("deduplicates in-flight and successful messages until TTL expiry", async () => {
  let time = 0;
  const guard = createMessageGuard({ now: () => time, dedupeTtlMs: 1000 });

  assert.equal(guard.begin(message("m1")).action, "process");
  const concurrent = guard.begin(message("m1"));
  assert.equal(concurrent.action, "duplicate");

  guard.succeed("m1");
  assert.equal(await concurrent.wait, true);
  assert.equal(guard.begin(message("m1")).action, "duplicate");

  time = 1001;
  assert.equal(guard.begin(message("m1")).action, "process");
});

test("failed message becomes retryable", async () => {
  const guard = createMessageGuard();
  assert.equal(guard.begin(message("m1")).action, "process");
  const duplicate = guard.begin(message("m1"));
  guard.fail("m1");
  assert.equal(await duplicate.wait, false);
  assert.equal(guard.begin(message("m1")).action, "process");
});

test("limits per sender without charging duplicates", () => {
  const guard = createMessageGuard({ perSenderLimit: 1, globalLimit: 10 });
  assert.equal(guard.begin(message("m1")).action, "process");
  assert.equal(guard.begin(message("m1")).action, "duplicate");
  assert.equal(guard.begin(message("m2")).action, "limited");
  assert.equal(guard.begin(message("m3", "sender-2")).action, "process");
});

test("limits globally and resets counters after window", () => {
  let time = 0;
  const guard = createMessageGuard({
    now: () => time,
    perSenderLimit: 10,
    globalLimit: 2,
    windowMs: 1000,
  });
  assert.equal(guard.begin(message("m1", "s1")).action, "process");
  assert.equal(guard.begin(message("m2", "s2")).action, "process");
  assert.equal(guard.begin(message("m3", "s3")).action, "limited");
  time = 1000;
  assert.equal(guard.begin(message("m4", "s3")).action, "process");
});

test("uses senderStaffId then anonymous fallback for sender key", () => {
  const guard = createMessageGuard({ perSenderLimit: 1, globalLimit: 10 });
  assert.equal(guard.begin({ msgId: "m1", senderStaffId: "staff" }).action, "process");
  assert.equal(guard.begin({ msgId: "m2", senderStaffId: "staff" }).action, "limited");
  assert.equal(guard.begin({ msgId: "m3" }).action, "process");
  assert.equal(guard.begin({ msgId: "m4" }).action, "limited");
});
