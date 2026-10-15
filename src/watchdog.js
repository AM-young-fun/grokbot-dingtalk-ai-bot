// Detects a dead or never-established DingTalk Stream connection and exits so the
// process supervisor (run.sh / PM2 / systemd) starts a fresh process.
export function startWatchdog({
  client,
  now = Date.now,
  exit = (code) => process.exit(code),
  log = console.log,
  pingIntervalMs = 30_000,
  checkIntervalMs = 5_000,
  connectTimeoutMs = 45_000,
  deadAfterMs = 90_000,
} = {}) {
  const startedAt = now();
  let lastAlive = startedAt;
  let lastPing = 0;
  let connectedOnce = false;
  let notConnectedSince = startedAt;
  let watched = null;

  const alive = () => { lastAlive = now(); };

  const tick = () => {
    const t = now();
    const socket = client.socket;
    if (socket && socket !== watched) {
      watched = socket;
      socket.on("pong", alive);
      socket.on("message", alive);
    }

    if (client.connected) {
      if (!connectedOnce) { connectedOnce = true; lastAlive = t; }
      notConnectedSince = null;
    } else if (notConnectedSince === null) {
      notConnectedSince = t;
    }

    if (notConnectedSince !== null && t - notConnectedSince > connectTimeoutMs) {
      log(`watchdog: not connected for ${Math.round((t - notConnectedSince) / 1000)}s, exiting for restart`);
      exit(1);
      return;
    }

    if (client.connected && socket && socket.readyState === 1 && t - lastPing >= pingIntervalMs) {
      lastPing = t;
      try { socket.ping(); } catch { /* the dead check below handles it */ }
    }

    if (client.connected && t - lastAlive > deadAfterMs) {
      log(`watchdog: no pong/message for ${Math.round((t - lastAlive) / 1000)}s, exiting for restart`);
      exit(1);
    }
  };

  const timer = setInterval(tick, checkIntervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
