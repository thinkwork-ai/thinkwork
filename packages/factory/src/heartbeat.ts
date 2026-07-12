/**
 * Daemon heartbeat file (U7, KTD-6). The daemon writes this file once per poll
 * cycle so an INDEPENDENT watchdog process can detect silence purely from the
 * file's age — no shared memory, no Slack bot token, no live daemon needed to
 * observe that the daemon has died.
 *
 * The file's MTIME is the liveness signal (its content is a human-readable ISO
 * timestamp for forensics). A missing file means the daemon has never written
 * one — treated by the watchdog as "down", not "fresh".
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Canonical heartbeat path under the state dir. */
export function heartbeatPath(stateDir: string): string {
  return join(stateDir, "daemon.heartbeat");
}

/** Stamp the heartbeat file (mtime = now). Parent dirs are created. */
export function writeHeartbeat(path: string, now: Date = new Date()): void {
  mkdirSync(dirname(path), { recursive: true });
  // The content is advisory; the watchdog reads mtime. Writing the timestamp
  // makes the file self-describing for a human tailing the state dir.
  writeFileSync(path, `${now.toISOString()}\n`);
}

/**
 * Age of the heartbeat in ms (now − mtime), or null when the file is absent or
 * unreadable. Null is a distinct "no heartbeat at all" signal for the watchdog.
 */
export function readHeartbeatAgeMs(
  path: string,
  now: Date = new Date(),
): number | null {
  try {
    const s = statSync(path);
    return now.getTime() - s.mtimeMs;
  } catch {
    return null;
  }
}
