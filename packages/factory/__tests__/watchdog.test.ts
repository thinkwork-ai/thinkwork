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

  it("stale heartbeat past grace → posts a webhook alert with the reason", async () => {
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
      graceMs: 0, // no startup grace for this direct-alert assertion
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

  it("missing heartbeat past grace → overdue and posts (daemon never started)", async () => {
    const posts: RecordedPost[] = [];
    const res = await runWatchdog({
      heartbeatPath: heartbeatPath(dir), // never written
      overdueMs: 5 * 60_000,
      now: () => new Date(),
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: recordingPoster(posts),
      graceMs: 0,
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
      graceMs: 0,
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
      graceMs: 0,
      log,
    });
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(false);
    expect(res.reason).toMatch(/webhook post failed/);
  });
});

describe("watchdog: startup grace, dedup, and recovery (Fix 3)", () => {
  const overdueMs = 5 * 60_000;
  const graceMs = 2 * 60_000;
  const escalationIntervalMs = 60 * 60_000;

  it("absent heartbeat at boot → no page within the grace, then pages once", async () => {
    const hb = heartbeatPath(dir); // absent (simulates the boot RunAtLoad tick)
    const posts: RecordedPost[] = [];
    const tick = (offsetMs: number) =>
      runWatchdog({
        heartbeatPath: hb,
        overdueMs,
        now: () => new Date(t0.getTime() + offsetMs),
        webhookUrl: "https://hooks.slack.test/abc",
        postWebhook: recordingPoster(posts),
        graceMs,
        escalationIntervalMs,
        log,
      });

    // Tick 1 (T0): overdue but still inside the grace window → no page.
    let res = await tick(0);
    expect(res.overdue).toBe(true);
    expect(res.posted).toBe(false);
    expect(res.reason).toMatch(/startup grace/);
    expect(posts).toHaveLength(0);

    // Tick 2 (T0 + 1 min): outage only 1 min old, still within 2 min grace.
    res = await tick(60_000);
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(0);

    // Tick 3 (T0 + 3 min): outage now past grace → pages exactly once.
    res = await tick(3 * 60_000);
    expect(res.posted).toBe(true);
    expect(posts).toHaveLength(1);
  });

  it("consecutive overdue checks alert once, then re-alert only on the escalation cadence", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const posts: RecordedPost[] = [];
    const tick = (offsetMs: number) =>
      runWatchdog({
        heartbeatPath: hb,
        overdueMs,
        now: () => new Date(t0.getTime() + offsetMs),
        webhookUrl: "https://hooks.slack.test/abc",
        postWebhook: recordingPoster(posts),
        graceMs: 0, // isolate dedup from grace
        escalationIntervalMs,
        log,
      });

    // First overdue tick pages.
    let res = await tick(10 * 60_000);
    expect(res.posted).toBe(true);
    expect(posts).toHaveLength(1);

    // Next two ticks (5 and 10 min later) are inside the hour → deduped.
    res = await tick(15 * 60_000);
    expect(res.posted).toBe(false);
    expect(res.reason).toMatch(/deduped/);
    res = await tick(20 * 60_000);
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(1);

    // Past the escalation interval (> 1 h since the first page) → re-pages once.
    res = await tick(10 * 60_000 + escalationIntervalMs + 1_000);
    expect(res.posted).toBe(true);
    expect(posts).toHaveLength(2);
  });

  it("recovery clears the alerted state and posts a one-shot recovery notice", async () => {
    const hb = heartbeatPath(dir);
    stampHeartbeatAt(hb, t0);
    const posts: RecordedPost[] = [];
    const common = {
      heartbeatPath: hb,
      overdueMs,
      webhookUrl: "https://hooks.slack.test/abc",
      postWebhook: recordingPoster(posts),
      graceMs: 0,
      escalationIntervalMs,
      log,
    };

    // Enter the alerted state on a stale heartbeat.
    let res = await runWatchdog({
      ...common,
      now: () => new Date(t0.getTime() + 10 * 60_000),
    });
    expect(res.posted).toBe(true);
    expect(posts).toHaveLength(1);

    // Daemon recovers: a fresh heartbeat clears state and posts a recovery.
    stampHeartbeatAt(hb, new Date(t0.getTime() + 11 * 60_000));
    res = await runWatchdog({
      ...common,
      now: () => new Date(t0.getTime() + 11 * 60_000 + 30_000),
    });
    expect(res.overdue).toBe(false);
    expect(res.posted).toBe(true);
    expect(res.reason).toBe("recovered");
    expect(posts).toHaveLength(2);
    expect(posts[1].text).toMatch(/RECOVERED/);

    // A subsequent fresh tick does NOT re-post the recovery (state was cleared).
    res = await runWatchdog({
      ...common,
      now: () => new Date(t0.getTime() + 12 * 60_000),
    });
    expect(res.posted).toBe(false);
    expect(posts).toHaveLength(2);
  });
});
