/**
 * Unit tests for LastMile webhook → NormalizedEvent mapping.
 *
 * Pure function test: drives `normalizeLastmileEvent(rawBody)` with a handful
 * of provider shapes and asserts the normalized output. When a real LastMile
 * sample lands this suite should flip from "shape guess" to "shape truth".
 */

import { describe, expect, it } from "vitest";
import { normalizeLastmileEvent } from "../integrations/external-work-items/providers/lastmile/normalizeEvent.js";

describe("normalizeLastmileEvent", () => {
	it("maps a task.created payload to kind=task.created with the task id", async () => {
		const body = JSON.stringify({
			event: "created",
			data: {
				task: {
					id: "task_001",
					assignee: { id: "user_abc" },
				},
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
			event: "assigned",
			data: { task: { id: "task_002", assignee: { id: "user_x" } } },
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.assigned");
		expect(evt.providerUserId).toBe("user_x");
	});

	it("maps status_changed (snake or dash) → task.status_changed", async () => {
		const snake = await normalizeLastmileEvent(
			JSON.stringify({ event: "status_changed", data: { task: { id: "t1" } } }),
		);
		expect(snake.kind).toBe("task.status_changed");

		const dash = await normalizeLastmileEvent(
			JSON.stringify({ event: "status-changed", data: { task: { id: "t2" } } }),
		);
		expect(dash.kind).toBe("task.status_changed");
	});

	it("maps closed → task.closed", async () => {
		const evt = await normalizeLastmileEvent(
			JSON.stringify({ event: "closed", data: { task: { id: "t3" } } }),
		);
		expect(evt.kind).toBe("task.closed");
	});

	it("extracts previousProviderUserId on reassignment", async () => {
		const body = JSON.stringify({
			event: "reassigned",
			data: {
				task: { id: "task_r", assignee: { id: "user_new" } },
				new_assignee: { id: "user_new" },
				previous_assignee: { id: "user_prev" },
			},
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.reassigned");
		expect(evt.providerUserId).toBe("user_new");
		expect(evt.previousProviderUserId).toBe("user_prev");
	});

	it("falls back to the top-level task_id when nested task is absent", async () => {
		const body = JSON.stringify({
			type: "updated",
			task_id: "task_fallback",
		});
		const evt = await normalizeLastmileEvent(body);
		expect(evt.kind).toBe("task.updated");
		expect(evt.externalTaskId).toBe("task_fallback");
	});

	it("throws on invalid JSON", async () => {
		await expect(normalizeLastmileEvent("{not json")).rejects.toThrow(/valid JSON/);
	});

	it("throws when no task id can be found anywhere", async () => {
		await expect(
			normalizeLastmileEvent(JSON.stringify({ event: "updated", data: {} })),
		).rejects.toThrow(/missing task id/);
	});

	it("preserves the raw payload on the normalized event", async () => {
		const payload = { event: "updated", data: { task: { id: "t4" } } };
		const evt = await normalizeLastmileEvent(JSON.stringify(payload));
		expect(evt.raw).toEqual(payload);
	});

	// ------------------------------------------------------------------------
	// Real LastMile webhook payload — pinned from Eric's test tenant
	// 2026-04-14. Keep this fixture in sync with production.
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
				status_id: "status_hfcqtycmuaix6pjfnu3mb3ot",
				company_id: "co_y15610tsjbkqz5cqoic8gjla",
				created_at: "2026-04-14T12:26:45.11+00:00",
				creator_id: "user_wv4f3er5wsdnev73kkavtixu",
				updated_at: "2026-04-14T12:26:45.11+00:00",
				assigned_at: "2026-04-14T12:26:45.11+00:00",
				assignee_id: "user_wv4f3er5wsdnev73kkavtixu",
				description: "this is a test ThinkWork integration task",
				entity_type: "basic",
				is_archived: false,
				task_number: 41366,
				workflow_id: "t15kbzez6y8e33qxdbkx7jt5",
				task_type_id: "task_type_fmk8znhdbqt2s1qnruawgmc3",
				organization_id: "org_sqc4e42x51o0d0xotp3h9c8r",
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
				task: { id: "task_x", assignee_id: "user_x" },
			},
		]);
		const evt = await normalizeLastmileEvent(body);
		expect(evt.providerEventId).toBe("outbox-fallback");
	});
});
