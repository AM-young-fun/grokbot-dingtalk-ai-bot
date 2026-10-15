# DingTalk Operator User ID Resolution

## Goal

Let operators configure the document CLI with the familiar DingTalk `userId`
instead of manually finding a `unionId`.

## Configuration

- Add `DINGTALK_OPERATOR_USER_ID`.
- For this deployment, its value is `01412445306844863`.
- Keep `DINGTALK_OPERATOR_ID` as a backward-compatible direct `unionId` input.
- Require AppKey, AppSecret, and at least one operator identity variable.
- If both identity variables exist, prefer `DINGTALK_OPERATOR_ID`; this preserves
  existing deployments and avoids an unnecessary API request.

## Runtime Flow

When only `DINGTALK_OPERATOR_USER_ID` is configured, use the existing application
access token to call DingTalk's employee-detail API. Extract the returned
`unionId`, cache it in memory for the process lifetime, then pass it as
`operatorId` to all document APIs.

No credential, access token, or resolved unionId is written to disk or logs.

## Errors

- Missing both identity variables: `CONFIG_MISSING`.
- User lookup denied: preserve authentication/permission error mapping.
- User not found or response lacks `unionId`: return a clear operator-resolution
  error without exposing tokens or secrets.

## Tests

- Config accepts userId alone and preserves unionId compatibility.
- Direct unionId takes precedence when both variables exist.
- userId is resolved once and reused across document calls.
- Lookup errors and missing `unionId` are safely mapped.
- README, skill instructions, and deployment examples use
  `DINGTALK_OPERATOR_USER_ID=01412445306844863`.
