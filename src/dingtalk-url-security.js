const SENSITIVE_QUERY_PARTS = new Set([
  'token', 'auth', 'authorization', 'credential', 'secret', 'signature', 'sign',
  'code', 'ticket', 'session', 'webhook', 'password', 'passphrase',
]);
const SENSITIVE_QUERY_NAMES = new Set([
  'accesstoken', 'clientsecret', 'apikey', 'privatekey', 'clientkey', 'signingkey',
]);

export function isSensitiveQueryKey(key) {
  const separated = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const parts = separated.split(/[^a-z0-9]+/).filter(Boolean);
  const normalized = parts.join('');
  return SENSITIVE_QUERY_NAMES.has(normalized)
    || parts.some((part) => SENSITIVE_QUERY_PARTS.has(part));
}
