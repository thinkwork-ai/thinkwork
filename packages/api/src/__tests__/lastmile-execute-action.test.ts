/**
 * Unit tests for the LastMile executeAction path — focused on the
 * field names that MUST match the real MCP tool schemas.
 *
 * Every write tool on the LastMile Tasks MCP server requires `taskId`
 * (NOT `id`) as its argument key. `task_update_assignee` takes
 * `assigneeId` (NOT `userId`). Tool input schemas are camelCase
 * end-to-end after LastMile's 2026-04 API rewrite (tool NAMES remain
 * snake_case — those are identifiers, not fields).
 *
 * There is no comment tool at all, so `external_task.comment` must
 * throw a clear error instead of silently calling a non-existent
 * `task_add_comment`.
 *
 * These tests mock `callMcpTool` (not fetch) so they verify the shape
 * our code HANDS to the client, not what the client does with it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCallMcpTool } = vi.hoisted(() => ({
	mockCallMcpTool: vi.fn(),
}));

vi.mock("../integrations/external-work-items/mcpClient.js", () => ({
	callMcpTool: mockCallMcpTool,
}));

// refreshLastmileTask is called after every successful mutation — stub it
// so the tests don't reach for a second mcpClient call.
vi.mock(
	"../integrations/external-work-items/providers/lastmile/refresh.js",
	async (importOriginal) => {
		const actual = (await importOriginal()) as Record<string, unknown>;
		return {
			...actual,
			refreshLastmileTask: vi.fn().mockResolvedValue({
				_type: "external_task",
				item: {
					core: {
						id: "task_1",
						provider: "lastmile",
						title: "Stub",
					},
					capabilities: {},
					fields: [],
					actions: [],
				},
				blocks: [],
			}),
		};
	},
);

import { executeLastmileAction } from "../integrations/external-work-items/providers/lastmile/executeAction.js";

const BASE_CTX = {
	tenantId: "tenant-1",
	userId: "user-1",
	connectionId: "conn-1",
	authToken: "access-token",
};

beforeEach(() => {
	mockCallMcpTool.mockReset();
	mockCallMcpTool.mockResolvedValue(undefined);
});

describe("executeLastmileAction — field names match MCP tool schemas", () => {
	it("update_status passes { taskId, statusId }", async () => {
		await executeLastmileAction({
			actionType: "external_task.update_status",
			externalTaskId: "task_1",
			params: { value: "status_new_id" },
			ctx: BASE_CTX,
		});

		expect(mockCallMcpTool).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: "task_update_status",
				args: { taskId: "task_1", statusId: "status_new_id" },
			}),
		);
	});

	it("update_status accepts explicit params.statusId as the source of truth", async () => {
		await executeLastmileAction({
			actionType: "external_task.update_status",
			externalTaskId: "task_1",
			params: { statusId: "status_explicit", value: "ignored" },
			ctx: BASE_CTX,
		});

		expect(mockCallMcpTool).toHaveBeenCalledWith(
			expect.objectContaining({
				args: { taskId: "task_1", statusId: "status_explicit" },
			}),
		);
	});

	it("assign uses tool name task_update_assignee and passes { taskId, assigneeId }", async () => {
		await executeLastmileAction({
			actionType: "external_task.assign",
			externalTaskId: "task_2",
			params: { userId: "user_lastmile_7" },
			ctx: BASE_CTX,
		});

		expect(mockCallMcpTool).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: "task_update_assignee",
				args: { taskId: "task_2", assigneeId: "user_lastmile_7" },
			}),
		);
	});

	it("assign accepts explicit params.assigneeId", async () => {
		await executeLastmileAction({
			actionType: "external_task.assign",
			externalTaskId: "task_2",
			params: { assigneeId: "user_lastmile_9" },
			ctx: BASE_CTX,
		});

		expect(mockCallMcpTool).toHaveBeenCalledWith(
			expect.objectContaining({
				args: { taskId: "task_2", assigneeId: "user_lastmile_9" },
			}),
		);
	});

	it("edit_fields uses task_update with taskId + the remaining form fields", async () => {
		await executeLastmileAction({
			actionType: "external_task.edit_fields",
			externalTaskId: "task_3",
			params: { _formId: "form_edit", title: "New title", description: "New desc" },
			ctx: BASE_CTX,
		});

		expect(mockCallMcpTool).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: "task_update",
				args: {
					taskId: "task_3",
					title: "New title",
					description: "New desc",
				},
			}),
		);
	});
});

describe("executeLastmileAction — comment is unsupported", () => {
	it("throws a clear error for external_task.comment", async () => {
		await expect(
			executeLastmileAction({
				actionType: "external_task.comment",
				externalTaskId: "task_4",
				params: { body: "any" },
				ctx: BASE_CTX,
			}),
		).rejects.toThrow(/comment is not supported/i);

		expect(mockCallMcpTool).not.toHaveBeenCalled();
	});
});

describe("executeLastmileAction — missing auth token", () => {
	it("refuses to run any write action without ctx.authToken", async () => {
		await expect(
			executeLastmileAction({
				actionType: "external_task.update_status",
				externalTaskId: "task_1",
				params: { value: "status_x" },
				ctx: { tenantId: "tenant-1", userId: "user-1", connectionId: "conn-1" },
			}),
		).rejects.toThrow(/per-user OAuth token/i);

		expect(mockCallMcpTool).not.toHaveBeenCalled();
	});
});
