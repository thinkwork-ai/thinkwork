/**
 * Independent daemon watchdog (U7, KTD-6; Flow F4).
 *
 * A LaunchAgent's own KeepAlive cannot announce that the daemon is wedged or
 * that launchd itself is failing to restart it — a dead daemon writes nothing.
 * This watchdog is a SEPARATE launchd interval job: it reads only the daemon
 * heartbeat file's age and, when overdue, posts to a plain Slack INCOMING
 * WEBHOOK. It deliberately shares nothing with the daemon — not the process,
 * not the Slack bot token, not the Socket Mode connection — so the daemon's
 * death is announceable precisely when the daemon can no longer speak for
 * itself.
 *
 * Pure over an injected clock + webhook poster so tests never touch the network
 * or wall-clock time.
 */

import { readHeartbeatAgeMs } from "./heartbeat.js";
import type { Logger } from "./logger.js";

export interface WatchdogResult {
  /** True when a webhook alert was actually delivered. */
  posted: boolean;
  /** Heartbeat age in ms, or null when the file is absent. */
  ageMs: number | null;
  /** True when the daemon is considered down (missing or stale heartbeat). */
  overdue: boolean;
  /** Human-readable explanation (also the alert body prefix). */
  reason: string;
}

export type WebhookPoster = (url: string, text: string) => Promise<void>;

export interface WatchdogDeps {
  heartbeatPath: string;
  /** A heartbeat older than this (ms) means the daemon is down. */
  overdueMs: number;
  now?: () => Date;
  /** Slack incoming webhook URL (config.slack.webhookUrl). */
  webhookUrl?: string;
  /** Injectable poster; defaults to a global-fetch JSON POST. */
  postWebhook?: WebhookPoster;
  /** Included in the alert so multi-host setups say WHICH mini went dark. */
  hostname?: string;
  log: Logger;
}

/** POST `{ "text": ... }` to a Slack incoming webhook via global fetch. */
export const defaultPostWebhook: WebhookPoster = async (url, text) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`webhook responded ${res.status} ${res.statusText}`);
  }
};

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * Evaluate daemon liveness from the heartbeat file and alert on silence.
 * Returns without posting when the heartbeat is fresh.
 */
export async function runWatchdog(
  deps: WatchdogDeps,
): Promise<WatchdogResult> {
  const now = deps.now?.() ?? new Date();
  const ageMs = readHeartbeatAgeMs(deps.heartbeatPath, now);
  const host = deps.hostname ?? "factory host";

  let overdue: boolean;
  let reason: string;
  if (ageMs === null) {
    overdue = true;
    reason =
      `no daemon heartbeat at ${deps.heartbeatPath} — the factory daemon has ` +
      "not started (or the state dir is wrong)";
  } else if (ageMs > deps.overdueMs) {
    overdue = true;
    reason =
      `factory daemon heartbeat is ${seconds(ageMs)}s old ` +
      `(overdue past ${seconds(deps.overdueMs)}s) — the daemon appears DOWN`;
  } else {
    deps.log.debug("watchdog: heartbeat fresh", { ageMs });
    return { posted: false, ageMs, overdue: false, reason: "heartbeat fresh" };
  }

  deps.log.error("watchdog: daemon overdue", { ageMs, reason });

  if (deps.webhookUrl === undefined || deps.webhookUrl.trim() === "") {
    deps.log.error(
      "watchdog: no slack.webhookUrl configured — cannot alert on daemon death",
    );
    return {
      posted: false,
      ageMs,
      overdue,
      reason: `${reason} (no slack.webhookUrl configured — alert suppressed)`,
    };
  }

  const post = deps.postWebhook ?? defaultPostWebhook;
  const text = `:rotating_light: *factory watchdog* — ${host}: ${reason}`;
  try {
    await post(deps.webhookUrl, text);
    deps.log.info("watchdog: posted daemon-down alert to Slack webhook");
    return { posted: true, ageMs, overdue, reason };
  } catch (e) {
    deps.log.error("watchdog: webhook post failed", { error: String(e) });
    return {
      posted: false,
      ageMs,
      overdue,
      reason: `${reason} (webhook post failed: ${String(e)})`,
    };
  }
}
