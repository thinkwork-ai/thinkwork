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
		// PR F: LastMile MCP exposes no comment tool — capability is false
		// so the mobile card hides the Comment button.
		expect(item.capabilities.commentOnTask).toBe(false);
		expect(item.capabilities.editTaskFields).toBe(true);
	});

	it("surfaces 3 action specs in stable id order (no Comment — unsupported)", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		expect(item.actions.map((a) => a.id)).toEqual([
			"act_update_status",
			"act_assign",
			"act_edit_fields",
		]);
	});

	it("unwraps a populated status object (LastMile tasks_get shape)", () => {
		const raw = {
			...(fixture as Record<string, unknown>),
			status: {
				id: "status_hfcqtycmuaix6pjfnu3mb3ot",
				name: "Backlog",
				color: "#969696",
				icon: "IconPercentage0",
			},
		};
		const item = lastmileAdapter.normalizeItem(raw);
		expect(item.core.status).toEqual({
			value: "status_hfcqtycmuaix6pjfnu3mb3ot",
			label: "Backlog",
			color: "#969696",
		});
		// Status field pre-fill uses the unwrapped id so a future save-edit
		// can round-trip the real LastMile status identifier.
		const statusField = item.fields.find((f) => f.key === "status");
		expect(statusField?.value).toBe("status_hfcqtycmuaix6pjfnu3mb3ot");
	});

	it("unwraps a populated priority object too", () => {
		const raw = {
			...(fixture as Record<string, unknown>),
			priority: { id: "prio_high", name: "High", color: "#f00" },
		};
		const item = lastmileAdapter.normalizeItem(raw);
		expect(item.core.priority).toEqual({
			value: "prio_high",
			label: "High",
			color: "#f00",
		});
	});

	it("still accepts legacy string values for status (older fixtures)", () => {
		// The existing fixture already drives this: status = "in_progress"
		// (a plain string) should fall through to statusLabelFor().
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		expect(item.core.status).toEqual({
			value: "in_progress",
			label: "In progress",
			color: "amber",
		});
	});
});

describe("lastmileAdapter.buildBlocks", () => {
	it("returns the default header → fields → badges → actions layout (edit form opens via modal sheet)", () => {
		const item = lastmileAdapter.normalizeItem(fixture as Record<string, unknown>);
		const blocks = lastmileAdapter.buildBlocks(item);
		expect(blocks.map((b) => b.type)).toEqual([
			"task_header",
			"field_list",
			"badge_row",
			"action_bar",
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
		expect(env._source?.tool).toBe("tasks_get");
		expect(env._source?.params).toEqual({ task_id: "task_abc123" });
		expect(env.item.forms?.edit?.id).toBe("form_edit");
		expect(env.blocks.length).toBeGreaterThan(0);
	});
});
