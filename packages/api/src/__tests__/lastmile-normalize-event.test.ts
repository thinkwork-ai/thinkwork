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
});
