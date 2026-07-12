/**
 * Quota classifier + cooldown window (U6, R14 / AE8). A simulated clock drives
 * both the store's `ended_at` stamping and the classifier's `now`, so no test
 * depends on wall-clock time.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStore, type FactoryStore } from "../src/store/db.js";
import { classifyQuota } from "../src/sweep/quota.js";

let dir: string;
let store: FactoryStore;
/** Mutable simulated clock shared with the store (controls ended_at stamps). */
let clockNow: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-quota-test-"));
  clockNow = new Date("2026-07-12T00:00:00.000Z");
  store = openStore(dir, () => clockNow);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (base: Date, minutes: number): Date =>
  new Date(base.getTime() + minutes * 60_000);

function insertQuotaCooldown(issueId: string, endedAt: Date): void {
  const id = store.insertAttempt({
    issueId,
    phase: "implement",
    attemptNumber: 1,
    state: "Running",
  });
  clockNow = endedAt; // ended_at is stamped from the store clock
  store.transitionAttempt(id, "QuotaCooldown", "provider rate-limit");
}

describe("classifyQuota — cooldown window (AE8)", () => {
  it("is `clear` when there is no terminal attempt", () => {
    expect(classifyQuota(store, "iss_none", clockNow).kind).toBe("clear");
  });

  it("is `clear` when the latest terminal attempt is not a QuotaCooldown", () => {
    const id = store.insertAttempt({
      issueId: "iss_ok",
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
    });
    store.transitionAttempt(id, "Succeeded", "merged");
    expect(classifyQuota(store, "iss_ok", clockNow).kind).toBe("clear");
  });

  it("is `cooldown` (with an until) while inside the window", () => {
    const ended = new Date("2026-07-12T01:00:00.000Z");
    insertQuotaCooldown("iss_q", ended);

    const verdict = classifyQuota(store, "iss_q", at(ended, 10), 30);
    expect(verdict.kind).toBe("cooldown");
    if (verdict.kind === "cooldown") {
      expect(verdict.until.toISOString()).toBe(at(ended, 30).toISOString());
    }
  });

  it("no kill/relaunch during cooldown — the classifier never touches the worker", () => {
    // (There is no worker to kill: QuotaCooldown is terminal. This asserts the
    // classifier is a pure read — the attempt row is unchanged after classify.)
    const ended = new Date("2026-07-12T01:00:00.000Z");
    insertQuotaCooldown("iss_q", ended);
    const before = store.getLatestTerminalAttempt("iss_q");
    classifyQuota(store, "iss_q", at(ended, 5), 30);
    const after = store.getLatestTerminalAttempt("iss_q");
    expect(after).toEqual(before);
  });

  it("becomes `expired` only PAST the window (escalation boundary)", () => {
    const ended = new Date("2026-07-12T01:00:00.000Z");
    insertQuotaCooldown("iss_q", ended);

    // At exactly the window edge it is still not expired (strict <).
    expect(classifyQuota(store, "iss_q", at(ended, 29), 30).kind).toBe(
      "cooldown",
    );
    expect(classifyQuota(store, "iss_q", at(ended, 30), 30).kind).toBe(
      "expired",
    );
    expect(classifyQuota(store, "iss_q", at(ended, 120), 30).kind).toBe(
      "expired",
    );
  });

  it("only the NEWEST terminal attempt governs (a later Succeeded clears an earlier cooldown)", () => {
    const ended = new Date("2026-07-12T01:00:00.000Z");
    insertQuotaCooldown("iss_q", ended);
    // A later attempt succeeds — the newest terminal is now Succeeded.
    const id2 = store.insertAttempt({
      issueId: "iss_q",
      phase: "implement",
      attemptNumber: 2,
      state: "Running",
    });
    store.transitionAttempt(id2, "Succeeded", "merged");
    expect(classifyQuota(store, "iss_q", at(ended, 5), 30).kind).toBe("clear");
  });
});
