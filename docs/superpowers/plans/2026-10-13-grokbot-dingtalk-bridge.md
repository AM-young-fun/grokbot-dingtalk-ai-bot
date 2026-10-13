# Grokbot DingTalk Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable Node.js bridge that receives DingTalk Stream robot text messages, passes the unchanged DingTalk `data` object to Grokbot, and replies through the message `sessionWebhook`.

**Architecture:** Keep DingTalk transport, filtering, Grokbot dispatch, and reply delivery in separate small modules. `src/index.js` wires the official `dingtalk-stream` client to a replaceable `handleDingTalkMessage(data)` function; pure functions and injected dependencies keep behavior testable without real credentials.

**Tech Stack:** Node.js 20+, ECMAScript modules, `dingtalk-stream`, built-in `fetch`, built-in `node:test`.

---

## File map

- `package.json`: runtime metadata, scripts, SDK dependency, Node version.
- `.gitignore`: excludes secrets and installed packages.
- `.env.example`: documents required environment variable names without values.
- `src/config.js`: validates DingTalk credentials.
- `src/message.js`: filters DingTalk messages and extracts text.
- `src/reply.js`: builds and sends DingTalk-standard text replies.
- `src/bridge.js`: runs one inbound message through Grokbot and reply delivery.
- `src/grokbot.js`: explicit Grokbot integration seam.
- `src/index.js`: creates DingTalk Stream client, parses callbacks, acknowledges messages.
- `test/config.test.js`: configuration tests.
- `test/message.test.js`: message filtering tests.
- `test/reply.test.js`: outbound payload and redaction tests.
- `test/bridge.test.js`: dispatch and fallback behavior tests.
- `README.md`: instructions written for Grokbot to configure, customize, run, and verify.

### Task 1: Project skeleton and configuration

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Create package metadata and secret-safe defaults**

```json
{
  "name": "grokbot-dingtalk-ai-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "dingtalk-stream": "^2.1.5"
  }
}
```

`.gitignore`:

```text
node_modules/
.env
npm-debug.log*
```

`.env.example`:

```text
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
```

- [ ] **Step 2: Write failing configuration tests**

```js
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
```

- [ ] **Step 3: Run test and verify failure**

Run: `npm test -- test/config.test.js`

Expected: FAIL because `src/config.js` does not exist.

- [ ] **Step 4: Implement configuration validation**

```js
export function loadConfig(env = process.env) {
  const required = ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    clientId: env.DINGTALK_CLIENT_ID.trim(),
    clientSecret: env.DINGTALK_CLIENT_SECRET.trim(),
  };
}
```

- [ ] **Step 5: Install dependency and run tests**

Run: `npm install && npm test -- test/config.test.js`

Expected: 2 tests pass and `package-lock.json` is created.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example src/config.js test/config.test.js
git commit -m "chore: initialize DingTalk bridge"
```

### Task 2: DingTalk message filtering

**Files:**
- Create: `src/message.js`
- Test: `test/message.test.js`

- [ ] **Step 1: Write failing message behavior tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getMessageText, shouldHandleMessage } from "../src/message.js";

test("accepts group text when robot is mentioned", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "2", isInAtList: true,
    msgtype: "text", text: { content: " hello " },
  }), true);
});

test("ignores group text without robot mention", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "2", isInAtList: false,
    msgtype: "text", text: { content: "hello" },
  }), false);
});

test("accepts private text", () => {
  assert.equal(shouldHandleMessage({
    conversationType: "1", msgtype: "text", text: { content: "hello" },
  }), true);
});

test("ignores non-text and blank text", () => {
  assert.equal(shouldHandleMessage({ conversationType: "1", msgtype: "picture" }), false);
  assert.equal(shouldHandleMessage({
    conversationType: "1", msgtype: "text", text: { content: "   " },
  }), false);
});

test("trims text without changing original data", () => {
  const data = { text: { content: " hello " } };
  assert.equal(getMessageText(data), "hello");
  assert.equal(data.text.content, " hello ");
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/message.test.js`

Expected: FAIL because `src/message.js` does not exist.

- [ ] **Step 3: Implement pure filtering functions**

```js
export function getMessageText(data) {
  return typeof data?.text?.content === "string" ? data.text.content.trim() : "";
}

export function shouldHandleMessage(data) {
  if (data?.msgtype !== "text" || !getMessageText(data)) return false;
  if (data.conversationType === "2") return data.isInAtList === true;
  return data.conversationType === "1";
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- test/message.test.js`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/message.js test/message.test.js
git commit -m "feat: filter DingTalk text messages"
```

### Task 3: DingTalk reply delivery

**Files:**
- Create: `src/reply.js`
- Test: `test/reply.test.js`

- [ ] **Step 1: Write failing reply tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTextReply, redactWebhook, sendReply } from "../src/reply.js";

test("builds DingTalk text payload", () => {
  assert.deepEqual(buildTextReply("answer"), {
    msgtype: "text", text: { content: "answer" },
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
  const result = await sendReply("https://oapi.dingtalk.com/robot/sendBySession?session=secret", "answer", {
    accessToken: "token", fetchImpl: fakeFetch,
  });
  assert.deepEqual(result, { errcode: 0 });
  assert.equal(calls[0].options.headers["x-acs-dingtalk-access-token"], "token");
  assert.deepEqual(JSON.parse(calls[0].options.body), buildTextReply("answer"));
});

test("rejects DingTalk API errors", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ errcode: 300001, errmsg: "session 不存在" }),
  });
  await assert.rejects(
    () => sendReply("https://oapi.dingtalk.com/robot/sendBySession?session=secret", "answer", { fetchImpl: fakeFetch }),
    /300001: session 不存在/,
  );
});

test("redacts session value", () => {
  assert.equal(
    redactWebhook("https://oapi.dingtalk.com/robot/sendBySession?session=secret"),
    "https://oapi.dingtalk.com/robot/sendBySession?session=%5BREDACTED%5D",
  );
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/reply.test.js`

Expected: FAIL because `src/reply.js` does not exist.

- [ ] **Step 3: Implement reply delivery**

```js
export function buildTextReply(content) {
  return { msgtype: "text", text: { content: String(content) } };
}

export function redactWebhook(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.searchParams.has("session")) url.searchParams.set("session", "[REDACTED]");
    return url.toString();
  } catch {
    return "[INVALID WEBHOOK]";
  }
}

export async function sendReply(sessionWebhook, content, options = {}) {
  if (!sessionWebhook) throw new Error("Missing sessionWebhook");
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (options.accessToken) headers["x-acs-dingtalk-access-token"] = options.accessToken;
  const response = await fetchImpl(sessionWebhook, {
    method: "POST", headers, body: JSON.stringify(buildTextReply(content)),
  });
  const result = await response.json();
  if (!response.ok || (result.errcode !== undefined && result.errcode !== 0)) {
    throw new Error(`DingTalk reply failed (${response.status}) ${result.errcode ?? "HTTP"}: ${result.errmsg ?? "unknown error"}`);
  }
  return result;
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- test/reply.test.js`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reply.js test/reply.test.js
git commit -m "feat: send DingTalk text replies"
```

### Task 4: Bridge orchestration and Grokbot seam

**Files:**
- Create: `src/bridge.js`
- Create: `src/grokbot.js`
- Test: `test/bridge.test.js`

- [ ] **Step 1: Write failing orchestration tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { processDingTalkMessage } from "../src/bridge.js";

const message = {
  conversationType: "1", msgtype: "text", text: { content: "question" },
  msgId: "msg-1", sessionWebhook: "https://example.test/session",
};

test("passes unchanged DingTalk data to Grokbot and replies once", async () => {
  const seen = [];
  const replies = [];
  const result = await processDingTalkMessage(message, {
    handleMessage: async (data) => { seen.push(data); return "answer"; },
    send: async (...args) => { replies.push(args); return { errcode: 0 }; },
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
    send: async (...args) => { replies.push(args); return { errcode: 0 }; },
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
    send: async (...args) => { replies.push(args); return { errcode: 0 }; },
  });
  assert.deepEqual(replies, [[message.sessionWebhook, "处理失败，请稍后重试"]]);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/bridge.test.js`

Expected: FAIL because `src/bridge.js` does not exist.

- [ ] **Step 3: Implement orchestration**

```js
import { shouldHandleMessage } from "./message.js";

const FAILURE_REPLY = "处理失败，请稍后重试";

export async function processDingTalkMessage(data, deps) {
  if (!shouldHandleMessage(data)) return { handled: false, reason: "ignored" };
  const logger = deps.logger ?? console;
  try {
    const answer = await deps.handleMessage(data);
    const content = typeof answer === "string" && answer.trim() ? answer.trim() : FAILURE_REPLY;
    await deps.send(data.sessionWebhook, content);
    return { handled: true, fallback: content === FAILURE_REPLY };
  } catch (error) {
    logger.error("Grokbot message processing failed", { msgId: data.msgId, error: error.message });
    await deps.send(data.sessionWebhook, FAILURE_REPLY);
    return { handled: true, fallback: true };
  }
}
```

Create `src/grokbot.js` as explicit installation seam:

```js
export async function handleDingTalkMessage(_data) {
  throw new Error("Grokbot integration is not configured. Implement src/grokbot.js.");
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- test/bridge.test.js`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge.js src/grokbot.js test/bridge.test.js
git commit -m "feat: add Grokbot message bridge"
```

### Task 5: Stream runtime

**Files:**
- Create: `src/index.js`
- Modify: `package.json`

- [ ] **Step 1: Implement SDK runtime wiring**

```js
import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { loadConfig } from "./config.js";
import { processDingTalkMessage } from "./bridge.js";
import { handleDingTalkMessage } from "./grokbot.js";
import { sendReply } from "./reply.js";

const config = loadConfig();
const client = new DWClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
});

client.registerCallbackListener(TOPIC_ROBOT, async (callback) => {
  const messageId = callback.headers.messageId;
  try {
    const data = typeof callback.data === "string" ? JSON.parse(callback.data) : callback.data;
    const accessToken = await client.getAccessToken();
    const result = await processDingTalkMessage(data, {
      handleMessage: handleDingTalkMessage,
      send: (webhook, content) => sendReply(webhook, content, { accessToken }),
    });
    client.socketCallBackResponse(messageId, { success: true, ...result });
  } catch (error) {
    console.error("DingTalk callback failed", { messageId, error: error.message });
    client.socketCallBackResponse(messageId, { success: false });
  }
});

client.connect();
console.log("DingTalk Stream bridge started");
```

- [ ] **Step 2: Run static import and full tests**

Run: `node --check src/index.js && npm test`

Expected: syntax check exits 0 and all tests pass.

- [ ] **Step 3: Verify missing credentials fail before connection**

Run: `env -u DINGTALK_CLIENT_ID -u DINGTALK_CLIENT_SECRET npm start`

Expected: process exits non-zero and names both missing variables.

- [ ] **Step 4: Commit**

```bash
git add src/index.js package.json
git commit -m "feat: connect DingTalk Stream runtime"
```

### Task 6: Grokbot-facing documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write operational README**

README must contain these concrete sections and commands:

```markdown
# Grokbot DingTalk Bridge

## What this project does
Receives DingTalk Stream robot messages. Group messages require @robot; private messages are accepted directly.

## Required DingTalk setup
Create an internal enterprise app, add robot capability, select Stream mode, publish it, then obtain Client ID/AppKey and Client Secret/AppSecret.

## Install and configure
\`\`\`bash
npm install
export DINGTALK_CLIENT_ID='replace-me'
export DINGTALK_CLIENT_SECRET='replace-me'
\`\`\`

## Connect Grokbot
Edit only `src/grokbot.js`. Keep the function signature:
\`\`\`js
export async function handleDingTalkMessage(data) {
  const question = data.text.content.trim();
  return await yourGrokbotCall(question, data);
}
\`\`\`
The `data` argument is the unchanged DingTalk robot callback data object.

## Run
\`\`\`bash
npm test
npm start
\`\`\`

## Production process
Use systemd, PM2, or a container restart policy. Inject secrets as environment variables. Never commit `.env`.

## End-to-end verification
Confirm Stream connected; test group @robot; confirm group without @ gets no reply; test private chat; restart process and repeat both accepted paths.
```

Also document text-only scope, `sessionWebhook` expiry, safe logging, expected failure reply, and exact DingTalk outbound JSON shape.

- [ ] **Step 2: Run documentation checks**

Run: `rg -n "Client ID|Client Secret|Stream|handleDingTalkMessage|sessionWebhook|npm start|npm test" README.md`

Expected: every required term is present.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Grokbot deployment guide"
```

### Task 7: Final verification

**Files:**
- Modify only files required by discovered defects.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test && node --check src/index.js && git status --short`

Expected: all tests pass, syntax check exits 0, and no uncommitted files remain.

- [ ] **Step 2: Inspect secret safety**

Run: `git grep -nE "(ClientSecret|DINGTALK_CLIENT_SECRET=.+|sendBySession\\?session=[^[:space:]]+)" -- ':!docs/superpowers/**'`

Expected: no committed real secret or complete session webhook. Variable names and redacted test fixtures are allowed.

- [ ] **Step 3: Report runtime boundary**

Report automated test result separately from live status. Without user-provided DingTalk credentials and a Grokbot implementation, do not claim live connectivity or deployed status.

