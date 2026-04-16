/**
 * Unit tests for the pure `parseCreateTaskConfig` helper inside the
 * `approveInboxItem` resolver. This is the narrow validation layer that
 * catches malformed agent-proposed payloads BEFORE we call LastMile —
 * anything that survives this function is shape-safe for `POST /tasks`.
 *
 * The resolver itself is integration-tested by
 * `scripts/integration/e2e-lastmile-create-task.ts` against the live dev
 * API; mocking the full DB + RDS Data API + LastMile REST here would be
 * high-maintenance with low signal.
 */

import { describe, it, expect } from "vitest";

// Duplicated from approveInboxItem.mutation.ts — keep in sync. The
// resolver function isn't exported (it's internal to the module) and
// re-exporting it just for tests would leak an implementation detail,
// so we mirror the logic here. Drift is caught by the e2e script.
function parseCreateTaskConfig(config: unknown): {
	title: string;
	terminalId: string;
	description?: string;
	priority?: string;
	assigneeId?: string;
	dueDate?: string;
	status?: string;
} {
	if (!config || typeof config !== "object") {
		throw new Error(
			"create_task inbox item is missing a config payload (expected { title, terminalId, ... })",
		);
	}
	const c = config as Record<string, unknown>;
	if (typeof c.title !== "string" || !c.title) {
		throw new Error("create_task config.title is required");
	}
	if (typeof c.terminalId !== "string" || !c.terminalId) {
		throw new Error("create_task config.terminalId is required");
	}
	const input: {
		title: string;
		terminalId: string;
		description?: string;
		priority?: string;
		assigneeId?: string;
		dueDate?: string;
		status?: string;
	} = {
		title: c.title,
		terminalId: c.terminalId,
	};
	if (typeof c.description === "string") input.description = c.description;
	if (typeof c.priority === "string") input.priority = c.priority;
	if (typeof c.assigneeId === "string") input.assigneeId = c.assigneeId;
	if (typeof c.dueDate === "string") input.dueDate = c.dueDate;
	if (typeof c.status === "string") input.status = c.status;
	return input;
}

describe("parseCreateTaskConfig", () => {
	it("accepts the minimum viable payload", () => {
		expect(
			parseCreateTaskConfig({ title: "Fix the pump", terminalId: "term_abc" }),
		).toEqual({ title: "Fix the pump", terminalId: "term_abc" });
	});

	it("passes through optional fields", () => {
		expect(
			parseCreateTaskConfig({
				title: "Fix",
				terminalId: "term_abc",
				description: "details",
				priority: "high",
				assigneeId: "user_abc",
				dueDate: "2026-04-20",
				status: "todo",
			}),
		).toEqual({
			title: "Fix",
			terminalId: "term_abc",
			description: "details",
			priority: "high",
			assigneeId: "user_abc",
			dueDate: "2026-04-20",
			status: "todo",
		});
	});

	it("ignores unknown keys defensively", () => {
		expect(
			parseCreateTaskConfig({
				title: "Fix",
				terminalId: "term_abc",
				provider: "lastmile", // extra field the skill writes for its own bookkeeping
				workflowId: "wf_123", // ThinkWork-side only, not sent to LastMile
			}),
		).toEqual({ title: "Fix", terminalId: "term_abc" });
	});

	it("rejects null config", () => {
		expect(() => parseCreateTaskConfig(null)).toThrow(
			"missing a config payload",
		);
	});

	it("rejects empty object", () => {
		expect(() => parseCreateTaskConfig({})).toThrow(
			"config.title is required",
		);
	});

	it("rejects missing title", () => {
		expect(() => parseCreateTaskConfig({ terminalId: "t" })).toThrow(
			"config.title is required",
		);
	});

	it("rejects empty-string title", () => {
		expect(() =>
			parseCreateTaskConfig({ title: "", terminalId: "t" }),
		).toThrow("config.title is required");
	});

	it("rejects missing terminalId", () => {
		expect(() => parseCreateTaskConfig({ title: "t" })).toThrow(
			"config.terminalId is required",
		);
	});

	it("rejects non-string title", () => {
		expect(() =>
			parseCreateTaskConfig({ title: 123, terminalId: "t" }),
		).toThrow("config.title is required");
	});

	it("drops non-string optional fields silently", () => {
		// Agent might pass null/undefined for unset optionals — drop them
		// rather than forwarding to LastMile where they'd 4xx on validation.
		expect(
			parseCreateTaskConfig({
				title: "Fix",
				terminalId: "t",
				priority: null,
				dueDate: undefined,
				description: 42,
			}),
		).toEqual({ title: "Fix", terminalId: "t" });
	});
});
