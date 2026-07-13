/**
 * The R18 status view (U8): built from the store only, no Linear calls.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildIssueStatus,
  buildStatusView,
  formatIssueStatusLive,
  formatStatusView,
  isStatusKeyword,
} from "../src/slack/status.js";
import { openStore, type FactoryStore } from "../src/store/db.js";

let dir: string;
let store: FactoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-status-test-"));
  store = openStore(dir);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("buildStatusView", () => {
  it("groups issues by phase and lists active + Stalled workers", () => {
    store.upsertIssue({
      issueId: "i1",
      identifier: "THINK-1",
      lane: "Claude",
      phase: "implement",
      state: "In Progress",
    });
    store.upsertIssue({
      issueId: "i2",
      identifier: "THINK-2",
      lane: "Claude",
      phase: "implement",
      state: "In Progress",
    });
    store.upsertIssue({
      issueId: "i3",
      identifier: "THINK-3",
      lane: "Codex",
      phase: "verify",
      state: "Verification",
    });

    // One running attempt, one stalled (terminal but surfaced).
    store.insertAttempt({
      issueId: "i1",
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      host: "mini",
      pid: 10,
    });
    const stalled = store.insertAttempt({
      issueId: "i3",
      phase: "verify",
      attemptNumber: 1,
      state: "Running",
      host: "laptop",
      pid: 11,
    });
    store.transitionAttempt(stalled, "Stalled", "no output for 20m");

    const view = buildStatusView(store, new Date());
    expect(view.issuesByPhase).toEqual([
      { phase: "implement", count: 2 },
      { phase: "verify", count: 1 },
    ]);
    // Running attempt + Stalled attempt both surfaced.
    const states = view.workers.map((w) => w.state).sort();
    expect(states).toEqual(["Running", "Stalled"]);
    const stalledWorker = view.workers.find((w) => w.state === "Stalled");
    expect(stalledWorker!.host).toBe("laptop");
    expect(stalledWorker!.identifier).toBe("THINK-3");
    expect(view.liveness.ageSeconds).not.toBeNull();

    // Renders without throwing.
    expect(formatStatusView(view)).toContain("Issues by phase");
  });

  it("reports an empty board cleanly", () => {
    const view = buildStatusView(store, new Date());
    expect(view.issuesByPhase).toEqual([]);
    expect(view.workers).toEqual([]);
    expect(view.liveness.ageSeconds).toBeNull();
    expect(formatStatusView(view)).toContain("no issues tracked yet");
  });
});

describe("buildIssueStatus", () => {
  it("returns one issue's phase/state and its active attempts", () => {
    store.upsertIssue({
      issueId: "i9",
      identifier: "THINK-9",
      lane: "Claude",
      phase: "plan",
      state: "Planning",
      compounded: 0,
    });
    store.insertAttempt({
      issueId: "i9",
      phase: "plan",
      attemptNumber: 1,
      state: "Running",
      host: "mini",
    });
    const status = buildIssueStatus(store, "i9");
    expect(status).not.toBeNull();
    expect(status!.identifier).toBe("THINK-9");
    expect(status!.state).toBe("Planning");
    expect(status!.activeAttempts).toHaveLength(1);
    expect(buildIssueStatus(store, "nope")).toBeNull();
  });
});

describe("formatIssueStatusLive", () => {
  it("renders LIVE Linear status even when the store row lags a phase behind", () => {
    // The store froze at implement/"Ready to Work" (status recorded at launch)
    // while the worker moved Linear to Verification — the answer must show
    // Verification, never the stale store state.
    store.upsertIssue({
      issueId: "i9",
      identifier: "THINK-9",
      lane: "Claude",
      phase: "implement",
      state: "Ready to Work",
    });
    store.insertAttempt({
      issueId: "i9",
      phase: "verify",
      attemptNumber: 1,
      state: "Running",
      host: "mini",
    });
    const stored = buildIssueStatus(store, "i9");
    const text = formatIssueStatusLive(
      "THINK-9",
      { state: "Verification", labels: ["Claude", "LFG"] },
      stored,
    );
    expect(text).toContain("THINK-9 — Verification");
    expect(text).toContain("labels: Claude, LFG");
    expect(text).toContain("verify attempt 1 — Running on mini");
    expect(text).not.toContain("Ready to Work");
  });

  it("shows the last terminal attempt when no worker is active", () => {
    store.upsertIssue({
      issueId: "i9",
      identifier: "THINK-9",
      lane: "Claude",
      phase: "implement",
      state: "In Progress",
    });
    const a = store.insertAttempt({
      issueId: "i9",
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      host: "mini",
    });
    store.transitionAttempt(a, "Succeeded", "done");
    const stored = buildIssueStatus(store, "i9");
    expect(stored!.latestAttempt!.state).toBe("Succeeded");
    const text = formatIssueStatusLive(
      "THINK-9",
      { state: "Verification", labels: ["Claude"] },
      stored,
    );
    expect(text).toContain("no active worker; last: implement attempt 1 — Succeeded");
  });

  it("falls back to the store view — LABELED as possibly stale — when Linear is unreachable", () => {
    store.upsertIssue({
      issueId: "i9",
      identifier: "THINK-9",
      lane: "Claude",
      phase: "plan",
      state: "Planning",
    });
    const text = formatIssueStatusLive("THINK-9", null, buildIssueStatus(store, "i9"));
    expect(text).toContain('status "Planning"');
    expect(text).toContain("couldn't reach Linear");
  });

  it("answers from live facts alone when the store has never tracked the issue", () => {
    const text = formatIssueStatusLive(
      "THINK-9",
      { state: "Brainstorming", labels: ["Claude"] },
      null,
    );
    expect(text).toContain("THINK-9 — Brainstorming");
    expect(text).toContain("no worker has run yet");
  });
});

describe("isStatusKeyword", () => {
  it("matches bare status requests, ignoring a leading @mention", () => {
    expect(isStatusKeyword("status")).toBe(true);
    expect(isStatusKeyword("  status?  ")).toBe(true);
    expect(isStatusKeyword("<@UBOT> status")).toBe(true);
    expect(isStatusKeyword("Status")).toBe(true);
    expect(isStatusKeyword("what's the status of the deploy")).toBe(false);
    expect(isStatusKeyword("Use Cognito.")).toBe(false);
  });
});
