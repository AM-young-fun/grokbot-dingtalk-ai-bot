# DingTalk Operator User ID Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the read-only DingTalk CLI to accept `DINGTALK_OPERATOR_USER_ID` and resolve its `unionId` automatically with the existing app token.

**Architecture:** Configuration accepts either a direct `operatorId` or an `operatorUserId`. A focused resolver calls `GET /v1.0/contact/users/{userId}`, caches the returned `unionId` in memory, and supplies it lazily to the document client. Existing direct-unionId deployments skip resolution.

**Tech Stack:** Node.js ESM, built-in `fetch`, `node:test`, DingTalk REST API.

---

### Task 1: Configuration fallback

**Files:**
- Modify: `src/dingtalk-tool-config.js`
- Test: `test/dingtalk-tool-config.test.js`

- [ ] **Step 1: Write failing tests**

Add tests proving `DINGTALK_OPERATOR_USER_ID` works alone, direct `DINGTALK_OPERATOR_ID` wins when both exist, and the missing-variable error names both alternatives.

- [ ] **Step 2: Verify RED**

Run: `node --test test/dingtalk-tool-config.test.js`
Expected: FAIL because userId is not accepted.

- [ ] **Step 3: Implement minimal config parsing**

Return `{ clientId, clientSecret, operatorId?, operatorUserId? }`; require at least one operator identity and prefer the direct operator ID.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/dingtalk-tool-config.test.js`
Expected: PASS.

### Task 2: Cached operator resolver

**Files:**
- Create: `src/dingtalk-operator.js`
- Create: `test/dingtalk-operator.test.js`

- [ ] **Step 1: Write failing resolver tests**

Test exact encoded URL and auth header, one-call process cache, direct-ID bypass, 401/403 mapping, 404/missing-`unionId` safe errors, and network failure redaction.

- [ ] **Step 2: Verify RED**

Run: `node --test test/dingtalk-operator.test.js`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement resolver**

Export `createOperatorIdProvider({ operatorId, operatorUserId, tokenProvider, fetchImpl, timeoutMs })` with `getOperatorId()`. Resolve using `GET https://api.dingtalk.com/v1.0/contact/users/{encodedUserId}` and `x-acs-dingtalk-access-token`; cache only valid non-empty `unionId`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/dingtalk-operator.test.js`
Expected: PASS.

### Task 3: Lazy document-client integration

**Files:**
- Modify: `src/dingtalk-doc-client.js`
- Modify: `src/dingtalk-tool-cli.js`
- Test: `test/dingtalk-doc-client.test.js`
- Test: `test/dingtalk-tool-cli.test.js`

- [ ] **Step 1: Write failing integration tests**

Prove document requests await `operatorIdProvider.getOperatorId()`, reuse the resolved value in query/body, and CLI wires userId config into the provider.

- [ ] **Step 2: Verify RED**

Run: `node --test test/dingtalk-doc-client.test.js test/dingtalk-tool-cli.test.js`
Expected: FAIL because clients require a direct string.

- [ ] **Step 3: Implement minimal integration**

Create provider in CLI. Change document client to resolve operator ID before each request while provider cache prevents repeated contact calls.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/dingtalk-doc-client.test.js test/dingtalk-tool-cli.test.js`
Expected: PASS.

### Task 4: Deployment and usage docs

**Files:**
- Modify: `README.md`
- Modify: `skills/dingtalk-grokbot-tool/SKILL.md`
- Modify: `deploy/bots/bot-one.env.example`
- Modify: `deploy/bots/bot-two.env.example`
- Modify: `.env.example`

- [ ] **Step 1: Update examples**

Use `DINGTALK_OPERATOR_USER_ID=01412445306844863`; explain direct `DINGTALK_OPERATOR_ID` remains an optional compatibility override.

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Security scan**

Run: `git grep -nE '(DINGTALK_CLIENT_SECRET=.+|access_token=.+)' -- ':!docs/superpowers/**'`
Expected: no committed credential values.

- [ ] **Step 4: Commit and push**

Commit implementation and documentation, then push `main` to `origin`.
