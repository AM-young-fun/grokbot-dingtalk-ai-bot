const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_PER_SENDER_LIMIT = 10;
const DEFAULT_GLOBAL_LIMIT = 100;

export function createMessageGuard({
  now = Date.now,
  dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS,
  windowMs = DEFAULT_WINDOW_MS,
  perSenderLimit = DEFAULT_PER_SENDER_LIMIT,
  globalLimit = DEFAULT_GLOBAL_LIMIT,
} = {}) {
  const messages = new Map();
  const senders = new Map();
  let globalWindow = { start: now(), count: 0 };

  function currentWindow(entry, time) {
    return !entry || time - entry.start >= windowMs
      ? { start: time, count: 0 }
      : entry;
  }

  function prune(time) {
    for (const [msgId, entry] of messages) {
      if (entry.expiresAt !== null && entry.expiresAt <= time) messages.delete(msgId);
    }
  }

  function begin(data) {
    const time = now();
    prune(time);

    const existing = messages.get(data.msgId);
    if (existing) return { action: "duplicate", wait: existing.promise };

    const senderKey = data.senderId || data.senderStaffId || "anonymous";
    const senderWindow = currentWindow(senders.get(senderKey), time);
    globalWindow = currentWindow(globalWindow, time);
    if (senderWindow.count >= perSenderLimit || globalWindow.count >= globalLimit) {
      return { action: "limited" };
    }

    senderWindow.count += 1;
    globalWindow.count += 1;
    senders.set(senderKey, senderWindow);

    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    messages.set(data.msgId, { promise, resolve, expiresAt: null });
    return { action: "process" };
  }

  function succeed(msgId) {
    const entry = messages.get(msgId);
    if (!entry) return;
    entry.expiresAt = now() + dedupeTtlMs;
    entry.resolve(true);
  }

  function fail(msgId) {
    const entry = messages.get(msgId);
    if (!entry) return;
    messages.delete(msgId);
    entry.resolve(false);
  }

  return { begin, succeed, fail };
}
