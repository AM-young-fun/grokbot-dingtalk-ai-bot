import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startWatchdog } from "../src/watchdog.js";

function setup(overrides = {}) {
  let t = 0;
  const socket = Object.assign(new EventEmitter(), { readyState: 1, pings: 0, ping() { this.pings++; } });
  const client = { socket, connected: false };
  const exits = [];
  const wd = startWatchdog({ client, now: () => t, exit: (c) => exits.push(c), log: () => {}, ...overrides });
  wd.stop();
  return { client, socket, exits, wd, advance: (ms) => { t += ms; } };
}

test("exits when never connected within the connect timeout", () => {
  const s = setup();
  s.advance(30_000); s.wd.tick();
  assert.deepEqual(s.exits, []);
  s.advance(20_000); s.wd.tick();
  assert.deepEqual(s.exits, [1]);
});

test("healthy connection pings and does not exit while pongs arrive", () => {
  const s = setup();
  s.client.connected = true;
  for (let i = 0; i < 20; i++) { s.advance(30_000); s.wd.tick(); s.socket.emit("pong"); }
  assert.deepEqual(s.exits, []);
  assert.ok(s.socket.pings >= 10);
});

test("exits when connected but nothing is heard for 90s", () => {
  const s = setup();
  s.client.connected = true;
  s.wd.tick();
  s.advance(60_000); s.wd.tick();
  assert.deepEqual(s.exits, []);
  s.advance(40_000); s.wd.tick();
  assert.deepEqual(s.exits, [1]);
});

test("inbound messages count as liveness", () => {
  const s = setup();
  s.client.connected = true;
  s.wd.tick();
  s.advance(80_000); s.socket.emit("message", "{}"); s.wd.tick();
  s.advance(80_000); s.wd.tick();
  assert.deepEqual(s.exits, []);
});

test("exits if the connection drops and is not re-connected in time", () => {
  const s = setup();
  s.client.connected = true;
  s.wd.tick();
  s.client.connected = false;
  s.advance(10_000); s.wd.tick();
  s.advance(50_000); s.wd.tick();
  assert.deepEqual(s.exits, [1]);
});
