import { describe, it, expect } from "vitest";
import {
  deriveLifecycleStatus,
  QUEUED_FRESHNESS_MS,
  type ThreadLifecycleStatus,
} from "../graphql/resolvers/threads/lifecycle-status.js";

const NOW = new Date("2026-04-24T12:00:00Z");
const FRESH_QUEUED_AT = new Date("2026-04-24T11:58:00Z"); // 2 min ago
const STALE_QUEUED_AT = new Date("2026-04-24T11:50:00Z"); // 10 min ago

describe("deriveLifecycleStatus", () => {
  // ── Active-turn probe wins regardless of latest-row ────────────────

  it("returns RUNNING when hasActiveTurn=true, regardless of latestTurn", () => {
    const cases = [
      null,
      { status: "succeeded", created_at: FRESH_QUEUED_AT },
      { status: "failed", created_at: FRESH_QUEUED_AT },
      { status: "queued", created_at: FRESH_QUEUED_AT },
    ];
    for (const latestTurn of cases) {
      expect(
        deriveLifecycleStatus({ hasActiveTurn: true, latestTurn, now: NOW }),
      ).toBe("RUNNING");
    }
  });

  it("handoff-window edge: committed succeeded row plus a newer fresh queued row → RUNNING", () => {
    // The active probe caught the queued turn; latestTurn carries the
    // older succeeded row. Active probe wins.
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: true,
        latestTurn: { status: "succeeded", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("RUNNING");
  });

  // ── Latest-row fallback mapping ────────────────────────────────────

  it("maps latest succeeded → COMPLETED", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "succeeded", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("COMPLETED");
  });

  it("maps latest cancelled → CANCELLED (user-initiated stop, distinct from system failure)", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "cancelled", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("CANCELLED");
  });

  it("maps latest failed → FAILED", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "failed", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("FAILED");
  });

  it("maps latest timed_out → FAILED", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "timed_out", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("FAILED");
  });

  it("maps latest skipped → IDLE", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "skipped", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  // ── Freshness guard on stuck queued rows ───────────────────────────

  it("stuck queued > 5 min (no active turn) → FAILED", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "queued", created_at: STALE_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("FAILED");
  });

  it("fresh queued ≤ 5 min but active probe missed → RUNNING (defensive)", () => {
    // Shouldn't happen in practice — if the row is fresh+queued, the
    // active probe should have caught it. Defensive branch.
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "queued", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("RUNNING");
  });

  it("defensive: latest running but active probe missed → RUNNING", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "running", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("RUNNING");
  });

  it("managed mobile handoff remains RUNNING while the shared turn is still running", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: true,
        latestTurn: { status: "running", created_at: FRESH_QUEUED_AT },
        now: NOW,
      }),
    ).toBe("RUNNING");
  });

  // ── No turns ──────────────────────────────────────────────────────

  it("no turns → IDLE", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: null,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  // ── Unknown status safety net ─────────────────────────────────────

  it("unknown thread_turns.status value → FAILED (surfaces mapping gaps to operators)", () => {
    // If a future migration adds a new status without updating this
    // mapping, the default branch routes to FAILED so the stuck row
    // lands in operator triage rather than silently resolving RUNNING
    // or the wrong state.
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: {
          status: "some_future_status",
          created_at: FRESH_QUEUED_AT,
        },
        now: NOW,
      }),
    ).toBe("FAILED");
  });

  // ── Pending ask_user_question → AWAITING_USER (plan 2026-06-09-005 U3) ──

  it("emits AWAITING_USER when a pending question exists, after a succeeded latest turn", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "succeeded", created_at: FRESH_QUEUED_AT },
        hasPendingQuestion: true,
        now: NOW,
      }),
    ).toBe("AWAITING_USER");
  });

  it("emits AWAITING_USER even when the latest turn FAILED — the needs-attention signal never drops", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "failed", created_at: FRESH_QUEUED_AT },
        hasPendingQuestion: true,
        now: NOW,
      }),
    ).toBe("AWAITING_USER");
  });

  it("pending question wins for every turn state (including active turns — the asking-turn tail window)", () => {
    const latestStatuses = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "timed_out",
      "cancelled",
      "skipped",
    ];
    for (const status of latestStatuses) {
      for (const hasActiveTurn of [true, false]) {
        expect(
          deriveLifecycleStatus({
            hasActiveTurn,
            latestTurn: { status, created_at: FRESH_QUEUED_AT },
            hasPendingQuestion: true,
            now: NOW,
          }),
        ).toBe("AWAITING_USER");
      }
    }
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: null,
        hasPendingQuestion: true,
        now: NOW,
      }),
    ).toBe("AWAITING_USER");
  });

  it("clears back to the turn-derived state once the question is consumed (hasPendingQuestion=false)", () => {
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "succeeded", created_at: FRESH_QUEUED_AT },
        hasPendingQuestion: false,
        now: NOW,
      }),
    ).toBe("COMPLETED");
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: true,
        latestTurn: { status: "running", created_at: FRESH_QUEUED_AT },
        hasPendingQuestion: false,
        now: NOW,
      }),
    ).toBe("RUNNING");
  });

  // ── Contracts ─────────────────────────────────────────────────────

  it("returns AWAITING_USER ONLY when a pending question exists (flipped from the reserved-enum guard)", () => {
    const latestStatuses = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "timed_out",
      "cancelled",
      "skipped",
    ];
    const outputs: ThreadLifecycleStatus[] = [];
    for (const status of latestStatuses) {
      for (const hasActiveTurn of [true, false]) {
        outputs.push(
          deriveLifecycleStatus({
            hasActiveTurn,
            latestTurn: { status, created_at: FRESH_QUEUED_AT },
            now: NOW,
          }),
        );
        outputs.push(
          deriveLifecycleStatus({
            hasActiveTurn,
            latestTurn: { status, created_at: STALE_QUEUED_AT },
            now: NOW,
          }),
        );
      }
    }
    outputs.push(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: null,
        now: NOW,
      }),
    );
    outputs.push(
      deriveLifecycleStatus({
        hasActiveTurn: true,
        latestTurn: null,
        now: NOW,
      }),
    );
    const emittable = ["RUNNING", "COMPLETED", "CANCELLED", "FAILED", "IDLE"];
    for (const output of outputs) {
      // Without a pending question the function NEVER emits AWAITING_USER…
      expect(output).not.toBe("AWAITING_USER");
      expect(emittable).toContain(output);
    }
    // …and with one it ALWAYS does (the new invariant).
    expect(
      deriveLifecycleStatus({
        hasActiveTurn: false,
        latestTurn: { status: "succeeded", created_at: FRESH_QUEUED_AT },
        hasPendingQuestion: true,
        now: NOW,
      }),
    ).toBe("AWAITING_USER");
  });

  it("QUEUED_FRESHNESS_MS is 5 minutes", () => {
    expect(QUEUED_FRESHNESS_MS).toBe(5 * 60 * 1000);
  });
});
