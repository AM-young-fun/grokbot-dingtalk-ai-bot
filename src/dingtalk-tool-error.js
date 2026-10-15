export class ToolError extends Error {
  constructor(code, message, { status = 0, retryAfter = null } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const EXIT_CODES = new Map([
  ['INVALID_ARGUMENT', 2],
  ['CONFIG_MISSING', 3],
  ['AUTH_FAILED', 4],
  ['DOCUMENT_FORBIDDEN', 4],
  ['NOT_FOUND', 5],
  ['UNSUPPORTED_CONTENT_TYPE', 5],
  ['RATE_LIMITED', 6],
  ['UPSTREAM_TIMEOUT', 7],
  ['UPSTREAM_ERROR', 7],
  ['OPERATOR_RESOLUTION_FAILED', 7],
]);

export function exitCodeFor(error) {
  return EXIT_CODES.get(error?.code) ?? 1;
}

export function toErrorEnvelope(error) {
  if (!(error instanceof ToolError)) {
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED',
        message: 'Unexpected error',
      },
    };
  }

  const envelope = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.retryAfter !== null && error.retryAfter !== undefined) {
    envelope.error.retryAfter = error.retryAfter;
  }

  return envelope;
}
