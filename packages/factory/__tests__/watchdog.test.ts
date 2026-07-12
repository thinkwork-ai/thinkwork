/**
 * Independent watchdog (U7, KTD-6). The daemon heartbeat file's age drives a
 * Slack incoming-webhook alert. The webhook is faked; the clock is injected;
 * the heartbeat file's mtime is pinned so age is deterministic.
 */

import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import { heartbeatPath, readHeartbeatAgeMs, writeHeartbeat } from "../src/heartbeat.js";
import { runWatchdog, type WebhookPoster } from "../src/watchdog.js";

let dir: string;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-watchdog-test-"));
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const t0 = new Date("2026-07-12T00:00:00.000Z");
/** Pin the heartbeat mtime to a known instant for deterministic age. */
function stampHeartbeatAt(path: string, when: Date): void {
  writeHeartbeat(path, when);
  utimesSync(path, when, when);
}

interface RecordedPost {
  url: string;
  text: string;
}
function recordingPoster(sink: RecordedPost[]): WebhookPoster {
  return async (url, text) => {
    sink.push({ url, text });
  };
}

describe("heartbeat file", () => {
  it("readHeartbeatAgeMs returns the age from mtime, null when absent", () => {
    const hb = heartbeatPath(dir);
    expect(readHeartbeatAgeMs(hb, new Date())).toBeNull();
    stampHeartbeatAt(hb, t0);
    const age = readHeartbeatAgeMs(hb, new Date(t0.getTime() + 5_000));
    expect(age).toBe(5_000);
  });
});

describe("watchdog", () => {
  it("fresh heartbeat → no alert", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const posts: RecordedPost[] = [];
    const res = await runWatchdog({
      heartbeatPath: hb,
      overdueMs: 5 * 60_000,
      now: () => new Date(t0.getTime() + 60_000), // 1 min old
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: recordingPoster(posts),
      log,
    });
    expect(res.overdue).toBe(false);
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("stale heartbeat → posts a webhook alert with the reason", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const posts: RecordedPost[] = [];
    const res = await runWatchdog({
      heartbeatPath: hb,
      overdueMs: 5 * 60_000,
      now: () => new Date(t0.getTime() + 10 * 60_000), // 10 min old
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: recordingPoster(posts),
      hostname: "mini",
      log,
    });
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://hooks.slack.test/abc");
    expect(posts[0].text).toMatch(/factory watchdog/);
    expect(posts[0].text).toMatch(/mini/);
    expect(posts[0].text).toMatch(/DOWN/);
  });

  it("missing heartbeat file → overdue and posts (daemon never started)", async () => {
    const posts: RecordedPost[] = [];
    const res = await runWatchdog({
      heartbeatPath: heartbeatPath(dir), // never written
      overdueMs: 5 * 60_000,
      now: () => new Date(),
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: recordingPoster(posts),
      log,
    });
    expect(res.ageMs).toBeNull();
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(true);
    expect(posts[0].text).toMatch(/not started/);
  });

  it("overdue but no webhook configured → does not post, reports suppression", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const res = await runWatchdog({
      heartbeatPath: hb,
      overdueMs: 5 * 60_000,
      now: () => new Date(t0.getTime() + 10 * 60_000),
      webhookUrl: undefined,
      log,
    });
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(false);
    expect(res.reason).toMatch(/no slack.webhookUrl/);
  });

  it("webhook throws → posted false, failure surfaced in the reason", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const res = await runWatchdog({
      heartbeatPath: hb,
      overdueMs: 5 * 60_000,
      now: () => new Date(t0.getTime() + 10 * 60_000),
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: async () => {
        throw new Error("503 from Slack");
      },
      log,
    });
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(false);
    expect(res.reason).toMatch(/webhook post failed/);
  });
});
