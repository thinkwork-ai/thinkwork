import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockInsert,
	mockInboxItemToCamel,
	mockRecordActivity,
	mockSendComputerApprovalPush,
} = vi.hoisted(() => ({
	mockInsert: vi.fn(),
	mockInboxItemToCamel: vi.fn(),
	mockRecordActivity: vi.fn(),
	mockSendComputerApprovalPush: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
	db: {
		insert: mockInsert,
	},
	inboxItems: {},
	inboxItemToCamel: mockInboxItemToCamel,
	recordActivity: mockRecordActivity,
}));

vi.mock("../../../lib/push-notifications.js", () => ({
	sendComputerApprovalPush: mockSendComputerApprovalPush,
}));

let resolver: typeof import("./createInboxItem.mutation.js");

beforeEach(async () => {
	vi.resetModules();
	mockInsert.mockReset();
	mockInboxItemToCamel.mockReset();
	mockRecordActivity.mockReset();
	mockSendComputerApprovalPush.mockReset();

	mockRecordActivity.mockResolvedValue(undefined);
	mockInboxItemToCamel.mockImplementation((row) => ({ id: row.id }));
	resolver = await import("./createInboxItem.mutation.js");
});

describe("createInboxItem computer approval push", () => {
	it("sends a mobile deep-link push when a computer approval inbox item is created", async () => {
		mockInsert.mockReturnValue({
			values: () => ({
				returning: () =>
					Promise.resolve([
						{
							id: "approval-1",
							tenant_id: "tenant-1",
							recipient_id: "user-1",
							type: "computer_approval",
							title: "Fallback title",
							description: "Fallback description",
							config: {
								question: "Read Gmail metadata for LastMile?",
								actionDescription: "Read sender and subject metadata only.",
							},
						},
					]),
			}),
		});

		const result = await resolver.createInboxItem(
			null,
			{
				input: {
					tenantId: "tenant-1",
					recipientId: "user-1",
					type: "computer_approval",
					title: "Fallback title",
					config: JSON.stringify({
						question: "Read Gmail metadata for LastMile?",
					}),
				},
			},
			{} as any,
		);

		expect(result).toEqual({ id: "approval-1" });
		expect(mockSendComputerApprovalPush).toHaveBeenCalledWith({
			userId: "user-1",
			tenantId: "tenant-1",
			approvalId: "approval-1",
			question: "Read Gmail metadata for LastMile?",
		});
	});

	it("does not push non-computer approvals or unassigned approval rows", async () => {
		await resolver.notifyComputerApprovalCreated({
			id: "routine-approval-1",
			tenant_id: "tenant-1",
			recipient_id: "user-1",
			type: "routine_approval",
		});
		await resolver.notifyComputerApprovalCreated({
			id: "computer-approval-1",
			tenant_id: "tenant-1",
			recipient_id: null,
			type: "computer_approval",
		});

		expect(mockSendComputerApprovalPush).not.toHaveBeenCalled();
	});

	it("keeps inbox creation successful when push delivery fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		mockSendComputerApprovalPush.mockRejectedValue(new Error("expo down"));
		mockInsert.mockReturnValue({
			values: () => ({
				returning: () =>
					Promise.resolve([
						{
							id: "approval-1",
							tenant_id: "tenant-1",
							recipient_id: "user-1",
							type: "computer_approval",
							title: "Approve this?",
						},
					]),
			}),
		});

		await expect(
			resolver.createInboxItem(
				null,
				{
					input: {
						tenantId: "tenant-1",
						recipientId: "user-1",
						type: "computer_approval",
						title: "Approve this?",
					},
				},
				{} as any,
			),
		).resolves.toEqual({ id: "approval-1" });
		consoleError.mockRestore();
	});
});

describe("computerApprovalPushQuestion", () => {
	it("uses the same summary fallback order as the Computer approval UI", () => {
		expect(
			resolver.computerApprovalPushQuestion({
				title: "Title fallback",
				description: "Description fallback",
				config: JSON.stringify({ questionText: "Question text?" }),
			}),
		).toBe("Question text?");
		expect(
			resolver.computerApprovalPushQuestion({
				title: "Title fallback",
				description: "Description fallback",
				config: { actionDescription: "Action fallback" },
			}),
		).toBe("Title fallback");
		expect(
			resolver.computerApprovalPushQuestion({
				description: "Description fallback",
				config: { action_description: "Action fallback" },
			}),
		).toBe("Action fallback");
	});
});
