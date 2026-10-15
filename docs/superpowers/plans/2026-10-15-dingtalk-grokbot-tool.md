# DingTalk Grokbot Read-only Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Node.js CLI named `dingtalk-grokbot-tool` that reuses each bridge instance's DingTalk credentials to browse workspaces, resolve document URLs, and read ALIDOC content.

**Architecture:** Keep CLI parsing, credential/token handling, DingTalk HTTP calls, and block rendering in separate dependency-injected modules. The CLI calls `api.dingtalk.com` directly and emits stable machine-readable output; Docker packages the existing bridge and CLI together so Compose can run isolated bot services from one image.

**Tech Stack:** Node.js 20 ESM, built-in `fetch`, `node:util.parseArgs`, Node test runner, Docker Compose.

---

## File map

- Create `src/dingtalk-tool-config.js`: validate shared credentials and fixed operator identity.
- Create `src/dingtalk-tool-error.js`: stable error type, redaction, and process exit-code mapping.
- Create `src/dingtalk-auth.js`: application-token acquisition and in-process refresh.
- Create `src/dingtalk-doc-client.js`: read-only DingTalk OpenAPI client and pagination envelopes.
- Create `src/dingtalk-doc-content.js`: sanitize blocks and render Markdown/text.
- Create `src/dingtalk-tool-cli.js`: command parsing, dispatch, and output selection.
- Create `bin/dingtalk-grokbot-tool.js`: executable entrypoint.
- Create matching `test/*.test.js` files and sanitized fixtures.
- Create `skills/dingtalk-grokbot-tool/SKILL.md`: AI routing and completeness rules.
- Create `Dockerfile`, `compose.yaml`, `.dockerignore`, and `deploy/bots/*.env.example`.
- Modify `package.json`, `.env.example`, `.gitignore`, and `README.md`.

### Task 1: Tool configuration and stable errors

**Files:**
- Create: `src/dingtalk-tool-config.js`
- Create: `src/dingtalk-tool-error.js`
- Create: `test/dingtalk-tool-config.test.js`
- Create: `test/dingtalk-tool-error.test.js`
- Modify: `.env.example`

- [ ] **Step 1: Write failing configuration and error tests**

Test that `loadToolConfig()` trims and returns `DINGTALK_CLIENT_ID`, `DINGTALK_CLIENT_SECRET`, and `DINGTALK_OPERATOR_ID`; missing values produce `CONFIG_MISSING` without printing values. Test exit mappings: invalid arguments `2`, configuration `3`, authentication/permission `4`, not-found/unsupported `5`, rate limit `6`, timeout/upstream `7`, unexpected `1`.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadToolConfig } from "../src/dingtalk-tool-config.js";
import { ToolError, exitCodeFor } from "../src/dingtalk-tool-error.js";

test("loads shared bridge credentials and fixed operator", () => {
  assert.deepEqual(loadToolConfig({
    DINGTALK_CLIENT_ID: " app ",
    DINGTALK_CLIENT_SECRET: " secret ",
    DINGTALK_OPERATOR_ID: " union ",
  }), { clientId: "app", clientSecret: "secret", operatorId: "union" });
});

test("reports missing variable names without values", () => {
  assert.throws(() => loadToolConfig({}), (error) =>
    error.code === "CONFIG_MISSING" &&
    /DINGTALK_CLIENT_ID/.test(error.message) &&
    !/secret-value/.test(error.message));
});

test("maps stable tool errors to documented process exits", () => {
  assert.equal(exitCodeFor(new ToolError("INVALID_ARGUMENT", "bad")), 2);
  assert.equal(exitCodeFor(new ToolError("AUTH_FAILED", "bad")), 4);
  assert.equal(exitCodeFor(new ToolError("RATE_LIMITED", "bad")), 6);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/dingtalk-tool-config.test.js test/dingtalk-tool-error.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement minimal config and error modules**

Implement `ToolError` with `code`, `status`, `retryAfter`; `toErrorEnvelope(error)` returning only safe fields; and `exitCodeFor(error)`. Implement `loadToolConfig(env = process.env)` using exact variable names above.

```js
export class ToolError extends Error {
  constructor(code, message, { status = 0, retryAfter = null } = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const EXIT_CODES = new Map([
  ["INVALID_ARGUMENT", 2], ["CONFIG_MISSING", 3],
  ["AUTH_FAILED", 4], ["DOCUMENT_FORBIDDEN", 4],
  ["NOT_FOUND", 5], ["UNSUPPORTED_CONTENT_TYPE", 5],
  ["RATE_LIMITED", 6], ["UPSTREAM_TIMEOUT", 7], ["UPSTREAM_ERROR", 7],
]);

export function exitCodeFor(error) { return EXIT_CODES.get(error?.code) ?? 1; }
export function toErrorEnvelope(error) {
  const result = { ok: false, error: { code: error?.code ?? "UNEXPECTED", message: error?.message ?? "Unexpected error" } };
  if (error?.retryAfter) result.error.retryAfter = error.retryAfter;
  return result;
}
```

- [ ] **Step 4: Document operator variable and rerun tests**

Append `DINGTALK_OPERATOR_ID=` to `.env.example`. Run `npm test`.

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dingtalk-tool-config.js src/dingtalk-tool-error.js test/dingtalk-tool-config.test.js test/dingtalk-tool-error.test.js .env.example
git commit -m "feat: add DingTalk tool configuration"
```

### Task 2: DingTalk application-token provider

**Files:**
- Create: `src/dingtalk-auth.js`
- Create: `test/dingtalk-auth.test.js`

- [ ] **Step 1: Write failing token tests**

Cover request shape, cache reuse, 60-second expiry skew, forced refresh, timeout, malformed response, and secret redaction. Use an injected `fetchImpl` and clock.

```js
const auth = createTokenProvider({
  clientId: "app",
  clientSecret: "secret",
  now: () => now,
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ accessToken: "token-1", expireIn: 7200 });
  },
});
assert.equal(await auth.getToken(), "token-1");
assert.equal(await auth.getToken(), "token-1");
assert.equal(calls.length, 1);
assert.deepEqual(JSON.parse(calls[0].init.body), { appKey: "app", appSecret: "secret" });
```

- [ ] **Step 2: Run focused test and verify failure**

Run: `node --test test/dingtalk-auth.test.js`

Expected: FAIL because `createTokenProvider` is missing.

- [ ] **Step 3: Implement token provider**

POST JSON to `https://api.dingtalk.com/v1.0/oauth2/accessToken`, apply a 10-second timeout, require non-empty `accessToken` and positive `expireIn`, cache until `expiresAt - 60_000`, and expose `getToken({ forceRefresh = false })`. Convert timeout to `UPSTREAM_TIMEOUT` and rejected credentials to `AUTH_FAILED`; never embed upstream body or credentials in errors.

- [ ] **Step 4: Run auth and full tests**

Run: `node --test test/dingtalk-auth.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dingtalk-auth.js test/dingtalk-auth.test.js
git commit -m "feat: add DingTalk token provider"
```

### Task 3: Read-only DingTalk document client

**Files:**
- Create: `src/dingtalk-doc-client.js`
- Create: `test/dingtalk-doc-client.test.js`
- Create: `test/fixtures/dingtalk-workspaces.json`
- Create: `test/fixtures/dingtalk-nodes.json`
- Create: `test/fixtures/dingtalk-node.json`
- Create: `test/fixtures/dingtalk-blocks.json`

- [ ] **Step 1: Write failing request-contract tests**

Test these exact calls with URL-encoded values and `x-acs-dingtalk-access-token`:

```text
GET  /v2.0/wiki/workspaces?operatorId=...&maxResults=...&nextToken=...
GET  /v2.0/wiki/workspaces/{workspaceId}?operatorId=...
GET  /v2.0/wiki/nodes?workspaceId=...&parentNodeId=...&operatorId=...&maxResults=...&nextToken=...
GET  /v2.0/wiki/nodes/{nodeId}?operatorId=...
POST /v2.0/wiki/nodes/queryByUrl?operatorId=...
GET  /v1.0/doc/suites/documents/{docKey}/blocks?operatorId=...
```

The URL resolver request body is `{ "url": "<validated URL>", "operatorId": "<unionId>" }`. Test only HTTPS hosts `alidocs.dingtalk.com` and `docs.dingtalk.com`; reject credentials, ports other than 443, and unrelated hosts before `fetch`.

- [ ] **Step 2: Run client test and verify failure**

Run: `node --test test/dingtalk-doc-client.test.js`

Expected: FAIL because client module is missing.

- [ ] **Step 3: Implement authenticated request core**

Implement `createDingTalkDocClient({ tokenProvider, operatorId, fetchImpl = fetch, timeoutMs = 10_000 })`. Its private request helper obtains a token, performs one request, refreshes and retries exactly once on HTTP 401, parses JSON only after bounding response size, and maps:

```text
400 invalid input -> INVALID_ARGUMENT
401 -> AUTH_FAILED
403 -> DOCUMENT_FORBIDDEN
404 -> NOT_FOUND
429 -> RATE_LIMITED with Retry-After
timeout -> UPSTREAM_TIMEOUT
other non-2xx/malformed JSON -> UPSTREAM_ERROR
```

- [ ] **Step 4: Implement read-only methods**

Expose:

```js
return {
  health: async () => {
    await request("/v2.0/wiki/workspaces", { query: { operatorId, maxResults: 1 } });
    return { authenticated: true, operatorIdConfigured: true, dingTalkReachable: true };
  },
  listWorkspaces: async ({ maxResults = 20, nextToken } = {}) => page(...),
  getWorkspace: async (workspaceId) => request(...),
  listNodes: async ({ workspaceId, parentNodeId, maxResults = 50, nextToken }) => page(...),
  getNode: async (nodeId) => request(...),
  resolveUrl: async (url) => request(...),
  getBlocks: async (docKey) => request(...),
};
```

Normalize DingTalk's `nextToken` into `{ data, page: { nextCursor, hasMore } }` without automatically exhausting pages.

- [ ] **Step 5: Run client and full tests**

Run: `node --test test/dingtalk-doc-client.test.js && npm test`

Expected: PASS; no write-method string such as `overwriteContent`, `DELETE`, or `/copy` exists under `src/dingtalk-doc-client.js`.

- [ ] **Step 6: Commit**

```bash
git add src/dingtalk-doc-client.js test/dingtalk-doc-client.test.js test/fixtures
git commit -m "feat: add read-only DingTalk document client"
```

### Task 4: Block sanitization and document rendering

**Files:**
- Create: `src/dingtalk-doc-content.js`
- Create: `test/dingtalk-doc-content.test.js`

- [ ] **Step 1: Write failing rendering tests**

Fixtures must cover paragraph, heading, ordered/unordered list, quote, code, link, table, and unknown block. Assert:

- raw blocks lose token/credential-like fields and keep structural IDs/types;
- Markdown preserves representable structure;
- text preserves readable spacing;
- unknown blocks remain in JSON/blocks and become `[Unsupported block: TYPE]` in Markdown/text;
- `normalizeDocument()` reports `unsupportedBlockTypes` and `truncated: false`.

- [ ] **Step 2: Run rendering test and verify failure**

Run: `node --test test/dingtalk-doc-content.test.js`

Expected: FAIL because rendering module is missing.

- [ ] **Step 3: Implement deterministic converters**

Export:

```js
export function sanitizeBlocks(blocks) { /* allowlist fields recursively */ }
export function blocksToMarkdown(blocks) { /* deterministic join with blank lines */ }
export function blocksToText(blocks) { /* strip presentation while preserving rows/lists */ }
export function normalizeDocument({ node, blocks }) {
  const safeBlocks = sanitizeBlocks(blocks);
  return {
    node,
    contentType: node?.contentType ?? node?.type ?? null,
    markdown: blocksToMarkdown(safeBlocks),
    text: blocksToText(safeBlocks),
    blocks: safeBlocks,
    unsupportedBlockTypes: collectUnsupported(safeBlocks),
    truncated: false,
  };
}
```

Use explicit block-type switches. Do not stringify unknown arbitrary objects into Markdown/text.

- [ ] **Step 4: Run rendering and full tests**

Run: `node --test test/dingtalk-doc-content.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dingtalk-doc-content.js test/dingtalk-doc-content.test.js
git commit -m "feat: normalize DingTalk document blocks"
```

### Task 5: Node.js CLI and executable package entry

**Files:**
- Create: `src/dingtalk-tool-cli.js`
- Create: `bin/dingtalk-grokbot-tool.js`
- Create: `test/dingtalk-tool-cli.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI tests**

Inject a fake client and output writers. Cover all commands, required flags, numeric range validation (`limit` 1-100), default JSON output, Markdown/text raw output, error JSON on stderr, and exit mapping.

```js
const result = await runCli(["nodes", "--workspace-id", "ws-1", "--limit", "25"], {
  env: fullEnv,
  createClient: () => fakeClient,
  stdout: (value) => stdout.push(value),
  stderr: (value) => stderr.push(value),
});
assert.equal(result, 0);
assert.deepEqual(fakeClient.calls[0], ["listNodes", { workspaceId: "ws-1", maxResults: 25 }]);
assert.equal(JSON.parse(stdout[0]).ok, true);
```

- [ ] **Step 2: Run CLI test and verify failure**

Run: `node --test test/dingtalk-tool-cli.test.js`

Expected: FAIL because CLI modules are missing.

- [ ] **Step 3: Implement parser and dispatcher**

Use `parseArgs({ strict: true, allowPositionals: true })`. Support exactly:

```text
health
workspaces --cursor --limit
workspace --workspace-id
nodes --workspace-id --parent-node-id --cursor --limit
node --node-id
resolve --url
read --node-id --format=json|markdown|text|blocks
```

For `read`, call `getNode(nodeId)`, reject a confirmed non-ALIDOC content type, select `docKey || dentryUuid || nodeId`, call `getBlocks()`, normalize content, then select output format.

- [ ] **Step 4: Add executable and package bin**

```js
#!/usr/bin/env node
import { runCli } from "../src/dingtalk-tool-cli.js";
process.exitCode = await runCli(process.argv.slice(2));
```

Add to `package.json`:

```json
"bin": {
  "dingtalk-grokbot-tool": "bin/dingtalk-grokbot-tool.js"
},
"scripts": {
  "start": "node src/index.js",
  "test": "node --test",
  "tool": "node bin/dingtalk-grokbot-tool.js"
}
```

Mark the executable bit on `bin/dingtalk-grokbot-tool.js`.

- [ ] **Step 5: Run CLI, syntax, and full tests**

Run:

```bash
node --test test/dingtalk-tool-cli.test.js
node --check bin/dingtalk-grokbot-tool.js
npm test
```

Expected: PASS. Run `env -u DINGTALK_CLIENT_ID -u DINGTALK_CLIENT_SECRET -u DINGTALK_OPERATOR_ID npm run tool -- health`; expect exit `3` and safe `CONFIG_MISSING` JSON on stderr.

- [ ] **Step 6: Commit**

```bash
git add src/dingtalk-tool-cli.js bin/dingtalk-grokbot-tool.js test/dingtalk-tool-cli.test.js package.json
git commit -m "feat: add dingtalk-grokbot-tool CLI"
```

### Task 6: AI skill and operator documentation

**Files:**
- Create: `skills/dingtalk-grokbot-tool/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Write the AI skill**

Use concise trigger metadata and hard rules:

```markdown
---
name: dingtalk-grokbot-tool
description: Read DingTalk knowledge-base workspaces, nodes, and ALIDOC content using the local read-only CLI. Use for known DingTalk document URLs/IDs or directory browsing; not for writes or full-text search.
---

# DingTalk Grokbot Tool

- Known URL: `dingtalk-grokbot-tool resolve --url '<url>'`, then read returned node ID.
- Known node: `dingtalk-grokbot-tool read --node-id '<id>' --format markdown`.
- Unknown location: list workspaces, then page through nodes using every returned `nextCursor`.
- Need exact structure: use `--format json` or `--format blocks` before summarizing.
- Never claim absence from one empty page, incomplete pagination, `DOCUMENT_FORBIDDEN`, or `UNSUPPORTED_CONTENT_TYPE`.
- Never print credentials, tokens, or complete sensitive URLs.
- Never attempt creation, modification, deletion, copying, moving, or permission changes.
```

- [ ] **Step 2: Extend README**

Document required scopes (`Document.Workspace.Read`, `Document.WorkspaceDocument.Read`, `Wiki.Node.Read`), the three variables, every command, output modes, pagination semantics, read-only boundary, and live verification distinction.

- [ ] **Step 3: Check docs and CLI names**

Run:

```bash
rg -n "dingtalk-grokbot-tool|DINGTALK_OPERATOR_ID|Document.WorkspaceDocument.Read" README.md skills/dingtalk-grokbot-tool/SKILL.md
rg -n "create|update|delete|write" skills/dingtalk-grokbot-tool/SKILL.md
```

Expected: first command finds documented contracts; second finds only prohibitions, not supported commands.

- [ ] **Step 4: Commit**

```bash
git add README.md skills/dingtalk-grokbot-tool/SKILL.md
git commit -m "docs: add DingTalk read tool guide"
```

### Task 7: Docker multi-bot packaging

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `deploy/bots/bot-one.env.example`
- Create: `deploy/bots/bot-two.env.example`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Write Dockerfile and ignore list**

Use `node:20-bookworm-slim`, `npm ci --omit=dev`, non-root `node`, and `CMD ["node", "src/index.js"]`. Copy `package*.json` before source for layer reuse. Keep `.git`, real `.env*`, coverage, and logs out of build context while explicitly retaining `.env.example` files.

- [ ] **Step 2: Add two-service Compose example**

```yaml
services:
  bot-one:
    build: .
    env_file: ./deploy/bots/bot-one.env
    restart: unless-stopped
    mem_limit: 768m
    cpus: 1.0
  bot-two:
    build: .
    env_file: ./deploy/bots/bot-two.env
    restart: unless-stopped
    mem_limit: 768m
    cpus: 1.0
```

Each example env lists the existing four bridge variables plus `DINGTALK_OPERATOR_ID`, with blank values only. Ignore `deploy/bots/*.env` but retain `*.env.example`.

- [ ] **Step 3: Document deployment and CLI invocation**

Add exact examples:

```bash
cp deploy/bots/bot-one.env.example deploy/bots/bot-one.env
docker compose up -d --build
docker compose ps
docker compose exec bot-one dingtalk-grokbot-tool health
docker compose exec bot-one dingtalk-grokbot-tool workspaces
docker compose restart bot-one
```

State that starting containers does not prove Stream delivery or document access.

- [ ] **Step 4: Build and inspect image**

Run:

```bash
docker compose config
docker build -t grokbot-dingtalk-ai-bot:test .
docker run --rm --entrypoint dingtalk-grokbot-tool grokbot-dingtalk-ai-bot:test health
```

Expected: Compose validates; image builds; last command exits `3` with `CONFIG_MISSING`, proving CLI is on `PATH` without requiring secrets.

- [ ] **Step 5: Run full regression suite**

Run: `npm test && node --check src/index.js && node --check bin/dingtalk-grokbot-tool.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore compose.yaml deploy/bots .gitignore README.md
git commit -m "feat: package independent Grokbot containers"
```

### Task 8: Security audit and acceptance handoff

**Files:**
- Modify tests or docs only if an audit exposes a concrete defect.

- [ ] **Step 1: Prove read-only source surface**

Run:

```bash
rg -n "overwriteContent|appendText|method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]" src bin
```

Expected: only token acquisition and URL-resolution POST calls appear; no DingTalk content-write endpoint appears.

- [ ] **Step 2: Scan tracked content for secret-like assignments**

Run:

```bash
git grep -nE "DINGTALK_(CLIENT_SECRET|CLIENT_ID)=.+|accessToken['\"]?\s*[:=]\s*['\"][A-Za-z0-9]" -- ':!docs/superpowers/**'
```

Expected: no real value; blank examples and synthetic test fixtures only.

- [ ] **Step 3: Run clean verification**

Run:

```bash
npm ci
npm test
node --check src/index.js
node --check bin/dingtalk-grokbot-tool.js
docker compose config
docker build -t grokbot-dingtalk-ai-bot:test .
git status --short
```

Expected: tests, syntax checks, Compose validation, and image build pass; worktree contains no unexpected files.

- [ ] **Step 4: Prepare live acceptance commands without running them**

Document commands for `health`, paged workspace/node browsing, URL resolution, four read formats, two-container isolation, and single-container restart. Do not claim live DingTalk success until credentials are injected and returned content is inspected.

- [ ] **Step 5: Commit any audit fixes**

If Step 1-4 required tracked changes, commit only those exact files:

```bash
git add <audited-files>
git commit -m "test: harden DingTalk read tool verification"
```

If no files changed, do not create an empty commit.
