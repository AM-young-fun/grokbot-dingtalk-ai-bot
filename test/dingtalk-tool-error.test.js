import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolError, exitCodeFor, toErrorEnvelope } from '../src/dingtalk-tool-error.js';

test('ToolError provides code, message, status, and retryAfter fields', () => {
  const error = new ToolError('RATE_LIMITED', 'Slow down', {
    status: 429,
    retryAfter: 30,
  });

  assert.equal(error.name, 'ToolError');
  assert.equal(error.code, 'RATE_LIMITED');
  assert.equal(error.message, 'Slow down');
  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, 30);
});

test('ToolError defaults status and retryAfter', () => {
  const error = new ToolError('UPSTREAM_ERROR', 'Failed');

  assert.equal(error.status, 0);
  assert.equal(error.retryAfter, null);
});

test('exitCodeFor maps known codes and defaults unknown codes to 1', () => {
  const mappings = {
    INVALID_ARGUMENT: 2,
    CONFIG_MISSING: 3,
    AUTH_FAILED: 4,
    DOCUMENT_FORBIDDEN: 4,
    NOT_FOUND: 5,
    UNSUPPORTED_CONTENT_TYPE: 5,
    RATE_LIMITED: 6,
    UPSTREAM_TIMEOUT: 7,
    UPSTREAM_ERROR: 7,
    SOMETHING_ELSE: 1,
  };

  for (const [code, exitCode] of Object.entries(mappings)) {
    assert.equal(exitCodeFor(code), exitCode, code);
  }
});

test('toErrorEnvelope exposes only safe error fields', () => {
  const error = new ToolError('UPSTREAM_ERROR', 'Request failed', { status: 502 });
  error.raw = { token: 'secret' };

  assert.deepEqual(toErrorEnvelope(error), {
    ok: false,
    error: {
      code: 'UPSTREAM_ERROR',
      message: 'Request failed',
    },
  });
});

test('toErrorEnvelope includes retryAfter only when present', () => {
  const error = new ToolError('RATE_LIMITED', 'Slow down', {
    status: 429,
    retryAfter: 15,
  });

  assert.deepEqual(toErrorEnvelope(error), {
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Slow down',
      retryAfter: 15,
    },
  });
});
