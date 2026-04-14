/**
 * Unit tests for the LastMile task normalizer + envelope builder.
 *
 * Fixture-driven: new LastMile shapes should be added to __fixtures__/ and
 * asserted here rather than reshaping the normalizer ad-hoc.
 */

import { describe, expect, it } from "vitest";
import fixture from "../integrations/external-work-items/providers/lastmile/__fixtures__/lastmile-task.json" with { type: "json" };
import { lastmileAdapter } from "../integrations/external-work-items/providers/lastmile/index.js";
import { envelopeFromRaw } from "../integrations/external-work-items/providers/lastmile/refresh.js";

describe("lastmileAdapter.normalizeItem", () => {
	it("maps snake_case fixture into NormalizedTask core", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);

		expect(item.core.id).toBe("task_abc123");
		expect(item.core.provider).toBe("lastmile");
		expect(item.core.title).toBe("Deliver groceries to 221B Baker St");
		expect(item.core.status).toEqual({
			value: "in_progress",
			label: "In progress",
			color: "amber",
		});
		expect(item.core.priority?.value).toBe("high");
		expect(item.core.assignee?.name).toBe("Alice Doe");
		expect(item.core.assignee?.email).toBe("alice@example.com");
		expect(item.core.dueAt).toBe("2026-04-20T12:00:00Z");
		expect(item.core.url).toContain("task_abc123");
	});

	it("produces default field specs with status/priority/assignee/dueAt/labels", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		const keys = item.fields.map((f) => f.key);
		expect(keys).toEqual(["status", "priority", "assignee", "dueAt", "labels"]);
	});

	it("declares the mutation capabilities needed for MVP", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		expect(item.capabilities.updateStatus).toBe(true);
		expect(item.capabilities.assignTask).toBe(true);
		expect(item.capabilities.commentOnTask).toBe(true);
		expect(item.capabilities.editTaskFields).toBe(true);
	});

	it("surfaces all 4 action specs in a stable id order", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		expect(item.actions.map((a) => a.id)).toEqual([
			"act_update_status",
			"act_assign",
			"act_comment",
			"act_edit_fields",
		]);
	});
});

describe("lastmileAdapter.buildBlocks", () => {
	it("returns the default header → fields → badges → actions → form layout", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		const blocks = lastmileAdapter.buildBlocks(item);
		expect(blocks.map((b) => b.type)).toEqual([
			"task_header",
			"field_list",
			"badge_row",
			"action_bar",
			"form",
		]);
	});
});

describe("lastmileAdapter.buildFormSchema", () => {
	it("returns an edit form bound to external_task.edit_fields", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		const form = lastmileAdapter.buildFormSchema(item);
		expect(form.id).toBe("form_edit");
		expect(form.actionType).toBe("external_task.edit_fields");
		expect(form.fields.map((f) => f.key)).toContain("status");
		expect(form.fields.map((f) => f.key)).toContain("description");
	});
});

describe("envelopeFromRaw", () => {
	it("wraps a raw task into an envelope with provider source metadata", () => {
		const env = envelopeFromRaw(fixture as Record<string, unknown>, "task_abc123");
		expect(env._type).toBe("external_task");
		expect(env._source?.provider).toBe("lastmile");
		expect(env._source?.tool).toBe("task_get");
		expect(env._source?.params).toEqual({ id: "task_abc123" });
		expect(env.item.forms?.edit?.id).toBe("form_edit");
		expect(env.blocks.length).toBeGreaterThan(0);
	});
});
