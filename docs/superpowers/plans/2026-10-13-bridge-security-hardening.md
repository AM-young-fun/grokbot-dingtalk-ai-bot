# DingTalk Bridge Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce safe outbound URLs, prevent duplicate or abusive Grokbot dispatch, and keep secrets out of logs.

**Architecture:** Add small pure validation and rate-limit helpers, then compose them in existing config, reply, and runtime boundaries. Keep all state process-local and dependency-free. Preserve current payload and ACK contracts except for explicit rejection or throttling cases.

**Tech Stack:** Node.js 20+, ECMAScript modules, built-in `fetch`, built-in `node:test`.

---

### Task 1: Validate Grokbot webhook configuration

**Files:**
- Modify: `test/config.test.js`
- Modify: `src/config.js`

- [ ] **Step 1: Write failing tests**

Add tests asserting `loadConfig` rejects `http://`, malformed, and credential-bearing webhook URLs while accepting an ordinary HTTPS URL.

- [ ] **Step 2: Verify RED**

Run: `node --test test/config.test.js`
Expected: new invalid-URL cases fail because current code only checks non-empty values.

- [ ] **Step 3: Implement minimal validation**

Add `validateWebhookUrl(value)` using `new URL(value)`. Require `https:`, no `username`, and no `password`. Throw `Invalid GROKBOT_WEBHOOK_URL: HTTPS URL without embedded credentials required`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/config.test.js`
Expected: all configuration tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "fix: validate Grokbot webhook URL"
```

### Task 2: Restrict DingTalk reply targets

**Files:**
- Modify: `test/reply.test.js`
- Modify: `src/reply.js`

- [ ] **Step 1: Write failing tests**

Add table-driven tests proving `sendAnswer` rejects HTTP, foreign hosts, credentials, non-443 ports, and wrong paths before `fetch`. Add acceptance cases for the exact DingTalk endpoint with default or explicit port 443.

- [ ] **Step 2: Verify RED**

Run: `node --test test/reply.test.js`
Expected: unsafe URLs currently reach the injected `fetch` function.

- [ ] **Step 3: Implement minimal validation**

Add `validateSessionWebhook(value)` requiring protocol `https:`, hostname `oapi.dingtalk.com`, port empty or `443`, pathname `/robot/sendBySession`, and empty URL credentials. Return normalized URL or throw `Invalid DingTalk sessionWebhook` with code `INVALID_SESSION_WEBHOOK`. Call it before `postSession`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/reply.test.js`
Expected: all reply tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reply.js test/reply.test.js
git commit -m "fix: restrict DingTalk session webhook"
```

### Task 3: Sanitize network errors and logs

**Files:**
- Modify: `test/runtime.test.js`
- Modify: `test/reply.test.js`
- Modify: `src/webhook.js`
- Modify: `src/runtime.js`
- Modify: `src/reply.js`

- [ ] **Step 1: Write failing tests**

Add tests where `fetch` throws an error containing a secret URL and token. Assert the exported error and captured runtime log contain only `WEBHOOK_NETWORK`, `WEBHOOK_TIMEOUT`, or `WEBHOOK_HTTP`, plus numeric status where relevant. Add reply API-error coverage asserting remote `errmsg` is not copied into thrown errors.

- [ ] **Step 2: Verify RED**

Run: `node --test test/runtime.test.js test/reply.test.js`
Expected: assertions find current raw `fetch` error or remote DingTalk error text.

- [ ] **Step 3: Implement stable safe errors**

Create errors with `.code` and optional `.status`; never interpolate underlying messages, response bodies, URLs, or authorization values. Runtime logs `{ msgId, status, code }`. Reply failure reports stable code and status only.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/runtime.test.js test/reply.test.js`
Expected: all targeted tests pass and captured output contains no test secrets.

- [ ] **Step 5: Commit**

```bash
git add src/webhook.js src/runtime.js src/reply.js test/runtime.test.js test/reply.test.js
git commit -m "fix: sanitize bridge network errors"
```

### Task 4: Add in-memory deduplication and rate limiting

**Files:**
- Create: `src/guard.js`
- Create: `test/guard.test.js`
- Modify: `src/runtime.js`
- Modify: `test/runtime.test.js`

- [ ] **Step 1: Write failing guard tests**

Specify `createMessageGuard({ now, dedupeTtlMs, windowMs, perSenderLimit, globalLimit })` with `begin(data)`, `succeed(msgId)`, and `fail(msgId)`. Cover first acceptance, concurrent duplicate detection, successful TTL retention, failed-attempt release, lazy expiry, per-sender limit, global limit, and duplicate calls not consuming quota.

- [ ] **Step 2: Verify RED**

Run: `node --test test/guard.test.js`
Expected: module-not-found failure because `src/guard.js` does not exist.

- [ ] **Step 3: Implement guard**

Use Maps for message states and fixed-window counters. Defaults: 10-minute dedupe TTL, 1-minute window, 10 per sender, 100 global. `begin` returns `{ action: "process" | "duplicate" | "limited", wait? }`; `succeed` retains the ID, while `fail` deletes it.

- [ ] **Step 4: Verify guard GREEN**

Run: `node --test test/guard.test.js`
Expected: all guard tests pass.

- [ ] **Step 5: Write failing runtime integration tests**

Cover missing `msgId` failure ACK, concurrent duplicates sharing one forward attempt, later duplicates skipping forwarding, failed delivery retry, and rate-limited messages receiving `{ success: true, handled: false }`.

- [ ] **Step 6: Verify runtime RED**

Run: `node --test test/runtime.test.js`
Expected: duplicate and rate-limit cases fail against current handler.

- [ ] **Step 7: Integrate guard**

Create one guard per callback handler unless injected. Check duplicate state before quota, await in-flight duplicates, retain successful IDs, release failed IDs, and log a stable `MESSAGE_RATE_LIMITED` event for drops.

- [ ] **Step 8: Verify runtime GREEN**

Run: `node --test test/guard.test.js test/runtime.test.js`
Expected: all guard and runtime tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/guard.js src/runtime.js test/guard.test.js test/runtime.test.js
git commit -m "fix: guard webhook dispatch abuse"
```

### Task 5: Full verification

**Files:**
- Modify: `README.md`
- Verify all modified files

- [ ] **Step 0: Document scheduled connection recovery**

Tell the deploying AI to resolve absolute `pm2` and `flock` paths, add a locked crontab entry that restarts `grokbot-dingtalk` every 10 minutes, and verify both crontab and PM2 state. Warn that restart interrupts in-flight work and clears the in-memory deduplication cache.

- [ ] **Step 1: Run full tests**

Run: `npm test`
Expected: zero failures.

- [ ] **Step 2: Run syntax checks**

Run: `node --check src/index.js && node --check src/config.js && node --check src/webhook.js && node --check src/reply.js && node --check src/runtime.js && node --check src/guard.js`
Expected: exit 0.

- [ ] **Step 3: Run dependency audit**

Run: `npm audit --omit=dev`
Expected: zero known vulnerabilities.

- [ ] **Step 4: Inspect diff and secret patterns**

Run: `git diff --check && git grep -nE '(http://|Bearer +[^$`{])' -- src test .env.example`
Expected: no whitespace errors and no newly hard-coded credential values; intentional HTTP test fixtures may appear only in tests.
