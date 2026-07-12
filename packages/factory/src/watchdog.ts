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

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readHeartbeatAgeMs } from "./heartbeat.js";
import type { Logger } from "./logger.js";

/**
 * Default escalation cadence: after the first daemon-down alert, only re-alert
 * once per hour rather than on EVERY watchdog interval — a real outage must not
 * flood the Slack channel with a page per tick.
 */
export const DEFAULT_ESCALATION_INTERVAL_MS = 60 * 60_000;
/**
 * Default startup grace: an overdue heartbeat must persist at least this long
 * before the FIRST page. This absorbs the install/reboot window where the
 * watchdog's immediate RunAtLoad tick runs while the daemon is still doing its
 * pre-heartbeat boot reconcile, so a transient absent/stale heartbeat at boot
 * does not fire a false alert.
 */
export const DEFAULT_STARTUP_GRACE_MS = 2 * 60_000;

export interface WatchdogResult {
  /** True when a webhook alert (down OR recovery) was actually delivered. */
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
  /**
   * Persistent alert state (dedup + grace + recovery) file. Defaults to
   * `watchdog.state` next to the heartbeat file.
   */
  statePath?: string;
  /** Re-alert cadence once already paging (default {@link DEFAULT_ESCALATION_INTERVAL_MS}). */
  escalationIntervalMs?: number;
  /** Overdue must persist this long before the first page (default {@link DEFAULT_STARTUP_GRACE_MS}). */
  graceMs?: number;
  log: Logger;
}

/**
 * On-disk watchdog alert state, persisted next to the heartbeat so a
 * short-lived per-tick watchdog process can dedup pages and recover across
 * runs. All timestamps are ISO strings; `null` means "not in that state".
 */
interface WatchdogState {
  /** When the current outage was first OBSERVED (starts the grace clock). */
  firstOverdueAt: string | null;
  /** When the first page for the current outage was SENT. */
  alertedAt: string | null;
  /** When the most recent page was sent (drives the escalation cadence). */
  lastEscalationAt: string | null;
}

const EMPTY_STATE: WatchdogState = {
  firstOverdueAt: null,
  alertedAt: null,
  lastEscalationAt: null,
};

function defaultStatePath(heartbeatPath: string): string {
  return join(dirname(heartbeatPath), "watchdog.state");
}

function readState(path: string): WatchdogState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<WatchdogState>;
    return {
      firstOverdueAt: parsed.firstOverdueAt ?? null,
      alertedAt: parsed.alertedAt ?? null,
      lastEscalationAt: parsed.lastEscalationAt ?? null,
    };
  } catch {
    // Absent or corrupt state → start clean.
    return { ...EMPTY_STATE };
  }
}

function writeState(path: string, state: WatchdogState, log: Logger): void {
  try {
    writeFileSync(path, `${JSON.stringify(state)}\n`);
  } catch (e) {
    // A watchdog that cannot persist state still ALERTS (never silently drops a
    // page) — it just loses dedup until the write recovers.
    log.warn("watchdog: could not persist alert state", { path, error: String(e) });
  }
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
 *
 * Alerting is stateful (persisted in a small `watchdog.state` file next to the
 * heartbeat) so that:
 *  - a sustained outage pages ONCE and then only re-pages on the escalation
 *    cadence, instead of flooding Slack on every interval;
 *  - a transient overdue heartbeat at install/reboot is absorbed by a startup
 *    grace window (the first page waits until the outage persists past
 *    `graceMs`), so the immediate RunAtLoad tick does not false-alarm; and
 *  - recovery (a fresh heartbeat after an alert) clears the alerted state and
 *    posts a one-shot recovery notice.
 */
export async function runWatchdog(
  deps: WatchdogDeps,
): Promise<WatchdogResult> {
  const now = deps.now?.() ?? new Date();
  const ageMs = readHeartbeatAgeMs(deps.heartbeatPath, now);
  const host = deps.hostname ?? "factory host";
  const statePath = deps.statePath ?? defaultStatePath(deps.heartbeatPath);
  const graceMs = deps.graceMs ?? DEFAULT_STARTUP_GRACE_MS;
  const escalationIntervalMs =
    deps.escalationIntervalMs ?? DEFAULT_ESCALATION_INTERVAL_MS;
  const hasWebhook =
    deps.webhookUrl !== undefined && deps.webhookUrl.trim() !== "";
  const post = deps.postWebhook ?? defaultPostWebhook;
  const state = readState(statePath);

  // --- Fresh heartbeat: recover (and clear alerted state) ------------------
  if (ageMs !== null && ageMs <= deps.overdueMs) {
    const wasAlerted = state.alertedAt !== null;
    writeState(statePath, { ...EMPTY_STATE }, deps.log);
    if (wasAlerted && hasWebhook) {
      const text =
        `:white_check_mark: *factory watchdog* — ${host}: daemon heartbeat is ` +
        `fresh again (${seconds(ageMs)}s old) — RECOVERED`;
      try {
        await post(deps.webhookUrl as string, text);
        deps.log.info("watchdog: posted recovery notice to Slack webhook");
        return { posted: true, ageMs, overdue: false, reason: "recovered" };
      } catch (e) {
        deps.log.error("watchdog: recovery webhook post failed", {
          error: String(e),
        });
        return {
          posted: false,
          ageMs,
          overdue: false,
          reason: `recovered (recovery webhook post failed: ${String(e)})`,
        };
      }
    }
    deps.log.debug("watchdog: heartbeat fresh", { ageMs });
    return { posted: false, ageMs, overdue: false, reason: "heartbeat fresh" };
  }

  // --- Overdue: absent or stale heartbeat ----------------------------------
  const reason =
    ageMs === null
      ? `no daemon heartbeat at ${deps.heartbeatPath} — the factory daemon has ` +
        "not started (or the state dir is wrong)"
      : `factory daemon heartbeat is ${seconds(ageMs)}s old ` +
        `(overdue past ${seconds(deps.overdueMs)}s) — the daemon appears DOWN`;

  // Start (or continue) the grace clock for this outage.
  if (state.firstOverdueAt === null) state.firstOverdueAt = now.toISOString();
  const overdueForMs = now.getTime() - Date.parse(state.firstOverdueAt);

  // Startup grace: hold the first page until the outage has persisted, so a
  // boot-time transient (daemon still doing its pre-heartbeat reconcile) does
  // not page. Never pages during grace, but persists the grace clock.
  if (state.alertedAt === null && overdueForMs < graceMs) {
    writeState(statePath, state, deps.log);
    deps.log.warn("watchdog: overdue but within startup grace — page held", {
      ageMs,
      overdueForMs,
      graceMs,
    });
    return {
      posted: false,
      ageMs,
      overdue: true,
      reason: `${reason} (within ${seconds(graceMs)}s startup grace — page held)`,
    };
  }

  deps.log.error("watchdog: daemon overdue", { ageMs, reason });

  if (!hasWebhook) {
    writeState(statePath, state, deps.log);
    deps.log.error(
      "watchdog: no slack.webhookUrl configured — cannot alert on daemon death",
    );
    return {
      posted: false,
      ageMs,
      overdue: true,
      reason: `${reason} (no slack.webhookUrl configured — alert suppressed)`,
    };
  }

  // Dedup: page on the FIRST overdue past grace, then only on the escalation
  // cadence — never once per interval.
  const firstPage = state.alertedAt === null;
  const sinceLastPageMs =
    state.lastEscalationAt === null
      ? Number.POSITIVE_INFINITY
      : now.getTime() - Date.parse(state.lastEscalationAt);
  if (!firstPage && sinceLastPageMs < escalationIntervalMs) {
    writeState(statePath, state, deps.log);
    deps.log.info("watchdog: overdue but already alerted — page deduped", {
      sinceLastPageMs,
      escalationIntervalMs,
    });
    return {
      posted: false,
      ageMs,
      overdue: true,
      reason: `${reason} (already alerted ${seconds(sinceLastPageMs)}s ago — page deduped)`,
    };
  }

  const text = `:rotating_light: *factory watchdog* — ${host}: ${reason}`;
  try {
    await post(deps.webhookUrl as string, text);
    if (firstPage) state.alertedAt = now.toISOString();
    state.lastEscalationAt = now.toISOString();
    writeState(statePath, state, deps.log);
    deps.log.info("watchdog: posted daemon-down alert to Slack webhook", {
      escalation: !firstPage,
    });
    return { posted: true, ageMs, overdue: true, reason };
  } catch (e) {
    writeState(statePath, state, deps.log);
    deps.log.error("watchdog: webhook post failed", { error: String(e) });
    return {
      posted: false,
      ageMs,
      overdue: true,
      reason: `${reason} (webhook post failed: ${String(e)})`,
    };
  }
}
