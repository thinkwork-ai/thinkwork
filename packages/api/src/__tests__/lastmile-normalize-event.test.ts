/**
 * Unit tests for LastMile webhook → NormalizedEvent mapping.
 *
 * Pure function test: drives `normalizeLastmileEvent(rawBody)` with a handful
 * of provider shapes and asserts the normalized output.
 *
 * All payloads are camelCase to match LastMile's post-rewrite Tasks API +
 * webhook format (2026-04).
 */

import { describe, expect, it } from "vitest";
import { normalizeLastmileEvent } from "../integrations/external-work-items/providers/lastmile/normalizeEvent.js";

describe("normalizeLastmileEvent", () => {
	it("maps a task.created payload to kind=task.created with the task id", async () => {
		const body = JSON.stringify({
			action: "created",
			task: {
				id: "task_001",
				assigneeId: "user_abc",
			},
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.created");
		expect(evt.externalTaskId).toBe("task_001");
		expect(evt.providerUserId).toBe("user_abc");
		expect(evt.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("maps assigned → task.assigned", async () => {
		const body = JSON.stringify({
			action: "assigned",
			task: { id: "task_002", assigneeId: "user_x" },
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.assigned");
		expect(evt.providerUserId).toBe("user_x");
	});

	it("maps statusChanged → task.status_changed", async () => {
		const evt = await normalizeLastmileEvent(
			JSON.stringify({ action: "statusChanged", task: { id: "t1" } }),
		);
		expect(evt.kind).toBe("task.status_changed");
	});

	it("maps closed → task.closed", async () => {
		const evt = await normalizeLastmileEvent(
			JSON.stringify({ action: "closed", task: { id: "t3" } }),
		);
		expect(evt.kind).toBe("task.closed");
	});

	it("extracts previousProviderUserId on reassignment", async () => {
		const body = JSON.stringify({
			action: "reassigned",
			task: { id: "task_r", assigneeId: "user_new" },
			newAssignee: { id: "user_new" },
			previousAssignee: { id: "user_prev" },
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.reassigned");
		expect(evt.providerUserId).toBe("user_new");
		expect(evt.previousProviderUserId).toBe("user_prev");
	});

	it("throws on invalid JSON", async () => {
		await expect(normalizeLastmileEvent("{not json")).rejects.toThrow(/valid JSON/);
	});

	it("throws when no task id can be found anywhere", async () => {
		await expect(
			normalizeLastmileEvent(JSON.stringify({ action: "updated" })),
		).rejects.toThrow(/missing task id/);
	});

	it("preserves the raw payload on the normalized event", async () => {
		const payload = { action: "updated", task: { id: "t4" } };
		const evt = await normalizeLastmileEvent(JSON.stringify(payload));
		expect(evt.raw).toEqual(payload);
	});

	// ------------------------------------------------------------------------
	// Real LastMile webhook payload — camelCase shape after the 2026-04
	// Tasks API + MCP rewrite. All body fields are camelCase end-to-end.
	// ------------------------------------------------------------------------

	const REAL_LASTMILE_PAYLOAD = [
		{
			eventId: "f2a869c5-d8d6-4f50-98de-5e6fa580ca24",
			occurredAt: "2026-04-14T12:27:10.550Z",
			companyId: "co_y15610tsjbkqz5cqoic8gjla",
			resource: "task",
			action: "created",
			entityId: "task_olli1gaiu4jf50m8dnww0gvy",
			meta: {},
			outboxId: "dc50bc69-2a1c-4bd7-ba2e-840ab442bf37",
			task: {
				id: "task_olli1gaiu4jf50m8dnww0gvy",
				title: "ThinkWork test",
				priority: "medium",
				statusId: "status_hfcqtycmuaix6pjfnu3mb3ot",
				companyId: "co_y15610tsjbkqz5cqoic8gjla",
				createdAt: "2026-04-14T12:26:45.11+00:00",
				creatorId: "user_wv4f3er5wsdnev73kkavtixu",
				updatedAt: "2026-04-14T12:26:45.11+00:00",
				assignedAt: "2026-04-14T12:26:45.11+00:00",
				assigneeId: "user_wv4f3er5wsdnev73kkavtixu",
				description: "this is a test ThinkWork integration task",
				entityType: "basic",
				isArchived: false,
				taskNumber: 41366,
				workflowId: "t15kbzez6y8e33qxdbkx7jt5",
				taskTypeId: "task_type_fmk8znhdbqt2s1qnruawgmc3",
				organizationId: "org_sqc4e42x51o0d0xotp3h9c8r",
			},
		},
	];

	it("normalizes the real LastMile batched-array payload", async () => {
		const evt = await normalizeLastmileEvent(JSON.stringify(REAL_LASTMILE_PAYLOAD));
		expect(evt.kind).toBe("task.created");
		expect(evt.externalTaskId).toBe("task_olli1gaiu4jf50m8dnww0gvy");
		expect(evt.providerUserId).toBe("user_wv4f3er5wsdnev73kkavtixu");
		expect(evt.providerEventId).toBe("f2a869c5-d8d6-4f50-98de-5e6fa580ca24");
		expect(evt.receivedAt).toBe("2026-04-14T12:27:10.550Z");
		// Raw is the unwrapped first element, not the outer array
		expect((evt.raw as Record<string, unknown>).resource).toBe("task");
	});

	it("throws on an empty array", async () => {
		await expect(normalizeLastmileEvent("[]")).rejects.toThrow(/empty array/);
	});

	it("falls back to outboxId when eventId is absent", async () => {
		const body = JSON.stringify([
			{
				outboxId: "outbox-fallback",
				action: "updated",
				task: { id: "task_x", assigneeId: "user_x" },
			},
		]);
		const evt = await normalizeLastmileEvent(body);
		expect(evt.providerEventId).toBe("outbox-fallback");
	});
});
