# DingTalk Bridge Security Hardening Design

## Scope

Fix four identified risks without changing the raw DingTalk-to-Grokbot payload contract:

1. Require HTTPS for the Grokbot webhook.
2. Add in-memory message deduplication and rate limiting.
3. Restrict reply targets to the DingTalk session-webhook endpoint.
4. Prevent network errors from exposing configured URLs or credentials in logs.

Persistent deduplication, distributed rate limiting, and payload minimization are outside this change.

## URL validation

Configuration startup validates `GROKBOT_WEBHOOK_URL` as an absolute HTTPS URL. Credentials embedded in the URL are rejected. Other HTTPS hosts remain supported because Grokbot controls its webhook host.

Before sending a reply, `sessionWebhook` must satisfy all conditions:

- protocol is `https:`;
- hostname is exactly `oapi.dingtalk.com`;
- port is absent or `443`;
- pathname is exactly `/robot/sendBySession`;
- URL contains no username or password.

Invalid targets fail before `fetch` runs.

## Deduplication

`createRobotCallbackHandler` owns an in-memory TTL cache keyed by DingTalk `msgId`. Default TTL is 10 minutes.

- First message starts processing and records an in-flight promise.
- Concurrent duplicate waits for the first attempt.
- Successful webhook acceptance keeps the message ID until TTL expiry; duplicates receive successful ACK without another webhook call.
- Failed webhook delivery removes the message ID so DingTalk retry can try again.
- Entries are lazily pruned during message handling.
- Missing `msgId` is rejected with failure ACK because it cannot be processed idempotently.

Cache is intentionally process-local. Restart clears it.

## Rate limiting

Apply fixed-window, in-memory limits before calling Grokbot:

- per sender: 10 accepted messages per minute;
- global: 100 accepted messages per minute.

Sender key uses `senderId`, then `senderStaffId`; messages lacking both use one shared anonymous key. Duplicates do not consume quota. Rate-limited messages receive successful ACK with `handled: false` so DingTalk does not retry them. Logs contain only event name and non-secret identifiers.

The handler accepts injected limiter, clock, thresholds, and TTL values for deterministic tests. Defaults require no new environment variables or packages.

## Safe errors and logging

Network-facing helpers expose stable error codes such as `WEBHOOK_TIMEOUT`, `WEBHOOK_NETWORK`, `WEBHOOK_HTTP`, and `INVALID_WEBHOOK_URL`. They do not include raw URLs, response bodies, authorization headers, or underlying `fetch` error messages.

Runtime logs include only `msgId`, numeric HTTP status when available, and stable error code. Reply errors follow the same rule and exclude remote error text.

## Tests

Add regression tests proving:

- HTTP Grokbot URLs and credential-bearing URLs fail configuration.
- Non-DingTalk, HTTP, credential-bearing, wrong-port, and wrong-path session webhooks never call `fetch`.
- Concurrent and later duplicates call Grokbot once.
- Failed delivery remains retryable.
- Per-sender and global limits drop excess messages without webhook calls or retry ACKs.
- Logged errors do not contain webhook URLs, query secrets, Bearer secrets, or raw network error text.
- Existing message filtering, reply formatting, reactions, and ACK behavior remain intact.
