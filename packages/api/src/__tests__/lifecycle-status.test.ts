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

	// ── Contracts ─────────────────────────────────────────────────────

	it("never returns AWAITING_USER — reserved for future user-input-awaiting signal", () => {
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
			deriveLifecycleStatus({ hasActiveTurn: false, latestTurn: null, now: NOW }),
		);
		outputs.push(
			deriveLifecycleStatus({ hasActiveTurn: true, latestTurn: null, now: NOW }),
		);
		for (const output of outputs) {
			expect(output).not.toBe("AWAITING_USER");
		}
	});

	it("QUEUED_FRESHNESS_MS is 5 minutes", () => {
		expect(QUEUED_FRESHNESS_MS).toBe(5 * 60 * 1000);
	});
});
