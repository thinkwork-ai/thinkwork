/**
 * PR C — `shouldPushExternalTaskEvent` pure-function coverage.
 *
 * This is the narrow "should we Expo-push the caller?" policy that sits
 * between the ingest pipeline and `sendExternalTaskPush`. The ingest
 * pipeline wiring is covered in `external-task-ingest-message.test.ts`;
 * this file just locks the branches of the decision function without
 * any DB, AppSync, or Expo mocking.
 *
 * v1 policy (kept narrow to avoid noise):
 *
 *   task.assigned / task.reassigned      → push ("Assigned to you")
 *   task.status_changed                  → push (summary)
 *   task.updated + status/due_* changed  → push (summary)
 *   task.updated + description/noise     → no push
 *   task.commented                       → no push
 *   task.created / task.closed / other   → no push
 */

import { describe, expect, it, vi } from "vitest";

// The helper lives inside ingestEvent.ts. We pull it out via a named
// import, which forces vitest to evaluate the module — and that module
// top-level imports `@thinkwork/database-pg`, `graphql/notify`, and
// `lib/push-notifications`. Stub the heavy ones so the module loads
// without a real DB / AppSync / Expo round-trip.

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({ insert: () => ({ values: () => Promise.resolve(undefined) }) }),
	schema: { messages: { id: "id" } },
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
}));

vi.mock("../integrations/external-work-items/index.js", () => ({
	getAdapter: vi.fn(),
	hasAdapter: vi.fn(),
}));

vi.mock("../lib/oauth-token.js", () => ({
	resolveConnectionByProviderUserId: vi.fn(),
	resolveOAuthToken: vi.fn(),
}));

vi.mock("../integrations/external-work-items/ensureExternalTaskThread.js", () => ({
	ensureExternalTaskThread: vi.fn(),
	closeExternalTaskThread: vi.fn(),
}));

vi.mock("../graphql/notify.js", () => ({
	notifyNewMessage: vi.fn(),
	notifyThreadUpdate: vi.fn(),
}));

vi.mock("../lib/push-notifications.js", () => ({
	sendExternalTaskPush: vi.fn(),
	sendTurnCompletedPush: vi.fn(),
}));

import { shouldPushExternalTaskEvent } from "../integrations/external-work-items/ingestEvent.js";
import type {
	ExternalTaskEnvelope,
	NormalizedEvent,
} from "../integrations/external-work-items/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
	return {
		kind: "task.updated",
		externalTaskId: "task_1",
		providerUserId: "user_lm_1",
		receivedAt: "2026-04-14T10:00:00Z",
		...overrides,
	};
}

function envelope(
	overrides: Partial<{
		title: string;
		status: { value: string; label: string };
	}> = {},
): ExternalTaskEnvelope {
	return {
		_type: "external_task",
		item: {
			core: {
				id: "task_1",
				provider: "lastmile",
				title: overrides.title ?? "Test Outbox",
				status: overrides.status,
			},
			capabilities: {},
			fields: [],
			actions: [],
		},
		blocks: [],
	};
}

const SUMMARY = "Status changed to In Progress";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("shouldPushExternalTaskEvent", () => {
	describe("assignment events", () => {
		it("pushes 'Assigned to you' on task.assigned", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.assigned" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: true, body: "Assigned to you" });
		});

		it("pushes 'Assigned to you' on task.reassigned", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.reassigned" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: true, body: "Assigned to you" });
		});
	});

	describe("task.status_changed", () => {
		it("pushes with the summary line", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.status_changed" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: true, body: SUMMARY });
		});
	});

	describe("task.updated", () => {
		it("pushes when status changes (propertiesUpdated)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["status"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: true, body: SUMMARY });
		});

		it("pushes when due_at changes", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["due_at"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result.push).toBe(true);
		});

		it("pushes when due_date changes (legacy key)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["due_date"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result.push).toBe(true);
		});

		it("pushes when status_id changes (id-based key)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["status_id"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result.push).toBe(true);
		});

		it("pushes when status + noise changes (mixed meaningful + noise)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["status", "updated_at"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result.push).toBe(true);
		});

		it("does NOT push for description-only changes", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["description"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push for priority-only changes (not in v1 pushable set)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["priority"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push for title-only changes", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["title"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push for updated_at-only changes (pure noise)", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: { propertiesUpdated: ["updated_at"] } }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push when raw has no propertiesUpdated", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ raw: {} }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push when raw is absent entirely", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent(),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});
	});

	describe("skipped event kinds (v1 noise policy)", () => {
		it("does NOT push task.created", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.created" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push task.commented", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.commented" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});

		it("does NOT push task.closed", () => {
			const result = shouldPushExternalTaskEvent(
				baseEvent({ kind: "task.closed" }),
				envelope(),
				SUMMARY,
			);
			expect(result).toEqual({ push: false });
		});
	});
});
