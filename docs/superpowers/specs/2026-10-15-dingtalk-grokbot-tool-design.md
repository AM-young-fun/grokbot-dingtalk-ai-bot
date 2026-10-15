# DingTalk Grokbot Read-only Tool Design

## Goal

Add a Node.js CLI named `dingtalk-grokbot-tool` so Grokbot instances can read DingTalk workspaces and documents through DingTalk OpenAPI. The CLI is read-only, reuses each bot instance's existing DingTalk application credentials, and ships in the same Docker image as the Stream bridge.

## Scope

The first release supports:

- checking configuration and DingTalk connectivity;
- listing readable workspaces;
- reading workspace metadata;
- listing workspace nodes with pagination;
- reading node metadata;
- resolving a DingTalk document URL to a stable node or document identifier;
- reading supported document content as normalized JSON, Markdown, plain text, or raw blocks.

The first release does not support:

- creating, updating, copying, moving, or deleting content;
- changing members or permissions;
- AI tables, spreadsheets, presentations, whiteboards, or arbitrary file conversion;
- full-text or semantic search;
- an additional local HTTP service;
- user-delegated authorization.

An empty browse result must not be described as proof that a document does not exist. The CLI can only report the workspaces, nodes, and pages returned to the configured application/operator identity.

## Identity and configuration

The CLI reads the same environment variables as the existing bridge:

```text
DINGTALK_CLIENT_ID
DINGTALK_CLIENT_SECRET
```

It does not introduce a second AppKey/AppSecret file or a separate service API key. The CLI exchanges these credentials for a DingTalk application access token and caches it in memory for the life of the process, refreshing before expiry or once after an authentication rejection.

The verified DingTalk document endpoints require an `operatorId`/`unionId` in addition to the application token. The CLI therefore reads one additional non-secret variable:

```text
DINGTALK_OPERATOR_ID
```

The operator is fixed per bot container. It must have read access to the target workspace and document. Credentials, access tokens, and complete credential-bearing URLs must never appear in stdout, stderr, or logs.

## Architecture

The implementation is split into small modules:

- `src/dingtalk-auth.js`: obtain and refresh DingTalk access tokens.
- `src/dingtalk-doc-client.js`: typed read-only DingTalk OpenAPI calls, pagination, timeouts, and error normalization.
- `src/dingtalk-doc-content.js`: convert DingTalk block responses into stable JSON, Markdown, and text.
- `src/dingtalk-tool-config.js`: validate CLI configuration without changing bridge startup behavior.
- `bin/dingtalk-grokbot-tool.js`: argument parsing, command dispatch, stdout/stderr, and exit codes.

The CLI calls DingTalk OpenAPI directly. There is no daemon, listening port, local HTTP API, database, Redis dependency, or cross-process token cache.

## CLI contract

The package exposes the `dingtalk-grokbot-tool` binary through `package.json`.

```bash
dingtalk-grokbot-tool health
dingtalk-grokbot-tool workspaces [--cursor <cursor>] [--limit <n>]
dingtalk-grokbot-tool workspace --workspace-id <id>
dingtalk-grokbot-tool nodes --workspace-id <id> [--parent-node-id <id>] [--cursor <cursor>] [--limit <n>]
dingtalk-grokbot-tool node --node-id <id>
dingtalk-grokbot-tool resolve --url <alidocs-url>
dingtalk-grokbot-tool read --node-id <id> [--format json|markdown|text|blocks]
```

Rules:

- Default output format is JSON.
- JSON output uses one top-level object and remains machine-readable without prose.
- `--format markdown` and `--format text` write only document content to stdout.
- Diagnostics go to stderr.
- Successful commands exit `0`; configuration, authorization, not-found, rate-limit, unsupported-content, timeout, and unexpected failures use documented non-zero exit codes.
- Pagination metadata is preserved. The CLI does not silently claim complete enumeration when more pages exist.
- URL resolution accepts only approved DingTalk document hosts and rejects embedded credentials, unexpected schemes, and unrelated hosts before any network request.

## Output envelope

JSON commands return:

```json
{
  "ok": true,
  "data": {},
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

Errors return:

```json
{
  "ok": false,
  "error": {
    "code": "DOCUMENT_FORBIDDEN",
    "message": "Configured DingTalk identity cannot read this document"
  }
}
```

Raw upstream bodies, tokens, secrets, and full sensitive URLs are not returned.

## Content normalization

`read` first resolves the node metadata needed by the document-content endpoint. For supported ALIDOC content it can return:

- `json`: metadata plus normalized content and completeness information;
- `markdown`: headings, paragraphs, lists, quotes, code blocks, links, and tables where representable;
- `text`: readable text with structural spacing;
- `blocks`: sanitized DingTalk block data for advanced consumers.

Unknown block types remain represented in JSON/blocks output and produce explicit placeholders in Markdown/text. They are not silently discarded. Responses report truncation, unsupported blocks, and pagination state.

Non-ALIDOC nodes return `UNSUPPORTED_CONTENT_TYPE`; the first release does not download or convert arbitrary files.

## AI usage guide

Add `skills/dingtalk-grokbot-tool/SKILL.md`. It tells an AI when and how to use the CLI:

- known document URL: run `resolve`, then `read`;
- known node ID: run `node` when metadata is needed, otherwise `read` directly;
- unknown location: run `workspaces`, then `nodes` level by level;
- connectivity or authorization uncertainty: run `health`;
- long or structured content: prefer JSON or blocks before summarizing;
- human-readable context: prefer Markdown;
- incomplete pagination: continue with `nextCursor` before making completeness claims;
- permission, unsupported-type, or empty-result errors: state the bounded result without claiming absence.

Add a human-facing deployment section to `README.md` covering installation, environment variables, commands, permissions, Docker Compose, and live acceptance.

## Docker deployment

Docker is the recommended multi-bot deployment method for the target 8-vCPU, 8-GB RAM, 120-GB Linux VM.

One image contains the Stream bridge and CLI. Each bot is a separate Compose service with:

- its own environment file;
- its own DingTalk and Grokbot credentials;
- `restart: unless-stopped`;
- an initial limit of `1.0` CPU and `768m` memory;
- no exposed port for the Stream bridge;
- the CLI available on `PATH` inside the container.

Image layers are shared. Real `.env` files remain ignored and are never committed. Local `npm start` remains supported; Docker is recommended, not a runtime requirement for the code.

The existing watchdog exits when the DingTalk Stream is dead so Docker restarts the affected container. A deployment must verify restart behavior per service. Periodic restart policy, if retained, must target each Compose service explicitly and must not use one shared lock or process name for all bots.

## Error handling

The client applies bounded request timeouts and normalizes upstream failures into stable codes:

- `CONFIG_MISSING`
- `AUTH_FAILED`
- `DOCUMENT_FORBIDDEN`
- `NOT_FOUND`
- `RATE_LIMITED`
- `UNSUPPORTED_CONTENT_TYPE`
- `UPSTREAM_TIMEOUT`
- `UPSTREAM_ERROR`
- `INVALID_ARGUMENT`

One authentication retry is allowed after refreshing the token. Rate limits preserve retry metadata when available but do not loop indefinitely. Network and DingTalk errors are sanitized before display.

## Testing

Automated tests use injected HTTP implementations and fixtures. They cover:

- shared environment configuration and missing variables;
- token acquisition, cache reuse, refresh, and single retry;
- URL allowlisting and identifier resolution;
- workspace and node pagination;
- document metadata and content reads;
- Markdown, text, JSON, and blocks output;
- unknown block preservation;
- forbidden, missing, rate-limited, timeout, malformed, and unsupported responses;
- secret and token redaction;
- CLI stdout/stderr separation and exit codes;
- existing bridge regression tests.

Docker checks verify image build, CLI presence, bridge startup command, and independent Compose service configuration.

## Live acceptance

Automated tests do not prove real DingTalk access. Release acceptance requires:

1. Start one configured bot container.
2. Run `health` inside it without exposing credentials.
3. List at least one authorized workspace and page through its nodes.
4. Resolve one real authorized DingTalk document URL.
5. Read that document as JSON, Markdown, text, and blocks.
6. Confirm an unauthorized document fails with a bounded permission result.
7. Start a second bot service with an independent environment file.
8. Confirm both Stream bridges remain connected and each CLI uses only its own container credentials.
9. Restart one service and verify the other remains unaffected.

Implementation, image build, container startup, and live DingTalk acceptance are reported as separate states.
