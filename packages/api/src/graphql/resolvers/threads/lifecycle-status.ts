/**
 * Thread lifecycle status — pure-function derivation from thread_turns.
 *
 * Emitted values: RUNNING | COMPLETED | CANCELLED | FAILED | IDLE.
 * AWAITING_USER exists in the GraphQL enum but is reserved; this function
 * never returns it — tests assert that invariant.
 *
 * The caller must perform two SQL probes (batched via a DataLoader in
 * practice) and pass the results here:
 *
 *   1. `hasActiveTurn`: true if any queued/running turn exists with
 *      created_at > now() - QUEUED_FRESHNESS_MS. When true, we return
 *      RUNNING immediately — the active probe handles the queued→running
 *      handoff window where the committed-history tail may still be a
 *      prior succeeded/failed row.
 *
 *   2. `latestTurn`: the most recent thread_turns row for the thread
 *      (status + created_at). When hasActiveTurn is false, this falls
 *      through the mapping table below. The freshness guard catches
 *      stuck queued rows (e.g. warm containers booted without env vars
 *      and stranded the turn) and routes them to FAILED instead of
 *      letting RUNNING latch forever.
 */

// Keep in sync with the `ThreadLifecycleStatus` enum in
// packages/database-pg/graphql/types/threads.graphql. packages/api has no
// GraphQL codegen, so this union is hand-maintained — adding or renaming
// a value here must match the canonical GraphQL enum and vice versa.
export type ThreadLifecycleStatus =
	| "RUNNING"
	| "COMPLETED"
	| "CANCELLED"
	| "FAILED"
	| "IDLE"
	| "AWAITING_USER";

export const QUEUED_FRESHNESS_MS = 5 * 60 * 1000;

export interface DeriveLifecycleStatusInput {
	hasActiveTurn: boolean;
	latestTurn: { status: string; created_at: Date } | null;
	now?: Date;
}

export function deriveLifecycleStatus({
	hasActiveTurn,
	latestTurn,
	now = new Date(),
}: DeriveLifecycleStatusInput): ThreadLifecycleStatus {
	if (hasActiveTurn) return "RUNNING";
	if (!latestTurn) return "IDLE";

	const { status, created_at } = latestTurn;
	const ageMs = now.getTime() - created_at.getTime();

	switch (status) {
		case "queued":
			// Defensive: if the active probe missed but the latest row is
			// fresh queued, treat as running. Stale queued → stuck dispatch.
			return ageMs <= QUEUED_FRESHNESS_MS ? "RUNNING" : "FAILED";
		case "running":
			return "RUNNING";
		case "succeeded":
			return "COMPLETED";
		case "cancelled":
			return "CANCELLED";
		case "failed":
		case "timed_out":
			return "FAILED";
		case "skipped":
			return "IDLE";
		default:
			// Unknown status — route to FAILED so operators notice and the
			// mapping gets updated. Log so silent drift surfaces in
			// CloudWatch; the mapping table needs updating when
			// thread_turns.status adds a new value.
			console.warn(
				`[lifecycle-status] Unknown thread_turns.status value "${status}" — routing to FAILED`,
			);
			return "FAILED";
	}
}
