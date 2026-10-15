---
name: dingtalk-grokbot-tool
description: Use when reading DingTalk knowledge-base workspaces, nodes, or ALIDOC content through the local read-only CLI from a known URL, ID, or directory browse; not for writes or full-text search.
---

# DingTalk Grokbot Read Tool

Use only `npm run tool -- ...` from this repository. The CLI reads `DINGTALK_CLIENT_ID`, `DINGTALK_CLIENT_SECRET`, and `DINGTALK_OPERATOR_ID` from its invoking process environment. `DINGTALK_OPERATOR_ID` is the acting user's unionId.

## Route the request

- Known DingTalk URL: resolve, take returned node ID, then read.
  ```bash
  npm run tool -- resolve --url 'https://docs.dingtalk.com/...'
  npm run tool -- read --node-id NODE_ID --format markdown
  ```
- Known node ID: read it. Fetch metadata first only when title, type, parent, or document support must be checked.
  ```bash
  npm run tool -- node --node-id NODE_ID
  npm run tool -- read --node-id NODE_ID --format markdown
  ```
- Unknown location: list workspaces, then traverse nodes level by level. Pass each directory node as `--parent-node-id`.
  ```bash
  npm run tool -- workspaces --limit 20
  npm run tool -- nodes --workspace-id WORKSPACE_ID --limit 50
  npm run tool -- nodes --workspace-id WORKSPACE_ID --parent-node-id PARENT_NODE_ID --limit 50
  ```
- Auth or connectivity doubt: `npm run tool -- health`.
- Workspace metadata: `npm run tool -- workspace --workspace-id WORKSPACE_ID`.

For `workspaces` and `nodes`, if `page.hasMore` is true, run the same command again with `--cursor 'page.nextCursor'`. Follow every cursor before claiming a listing is complete.

## Choose output

```bash
npm run tool -- read --node-id NODE_ID --format json
npm run tool -- read --node-id NODE_ID --format blocks
npm run tool -- read --node-id NODE_ID --format markdown
npm run tool -- read --node-id NODE_ID --format text
```

- `json` (default): normalized metadata, blocks, Markdown, and text.
- `blocks`: exact normalized structure.
- `markdown`: best human-reading context.
- `text`: simple extraction only.

**Hard rule:** When exact or structured content matters, read `--format json` or `--format blocks` before summarizing. Never summarize from `markdown` or `text` first; those renderings can lose structure.

Successful structured commands emit `{"ok":true,"data":...}`; paginated commands also emit `page`. Markdown/text reads emit plain stdout. Errors emit safe JSON on stderr.

## Boundaries and errors

Exit `0` success; `1` unexpected; `2` invalid arguments; `3` missing config; `4` authentication/permission; `5` missing resource/unsupported content; `6` rate limit; `7` timeout/upstream failure.

Empty pages, `DOCUMENT_FORBIDDEN`, `UNSUPPORTED_CONTENT_TYPE`, and unfinished pagination are bounded results, not proof that content does not exist. Report the boundary.

Never print credentials, access tokens, or full sensitive URLs. Never create, update, delete, copy, move, or change permissions. This CLI has no full-text search; locate content by URL, ID, or directory traversal only.
