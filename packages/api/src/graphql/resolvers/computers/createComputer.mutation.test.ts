import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockRequireTenantAdmin,
	mockResolveCallerUserId,
	mockCreateComputerCore,
	lastCoreInputRef,
} = vi.hoisted(() => ({
	mockRequireTenantAdmin: vi.fn(),
	mockResolveCallerUserId: vi.fn(),
	mockCreateComputerCore: vi.fn(),
	lastCoreInputRef: { value: null as Record<string, unknown> | null },
}));

vi.mock("../core/authz.js", () => ({
	requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
	resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
	createComputerCore: (input: Record<string, unknown>) => {
		lastCoreInputRef.value = input;
		return mockCreateComputerCore(input);
	},
	toGraphqlComputer: (row: Record<string, unknown>) => ({
		id: row.id,
		tenantId: row.tenant_id,
	}),
}));

let resolver: typeof import("./createComputer.mutation.js");

beforeEach(async () => {
	vi.resetModules();
	mockRequireTenantAdmin.mockReset();
	mockResolveCallerUserId.mockReset();
	mockCreateComputerCore.mockReset();
	lastCoreInputRef.value = null;

	mockResolveCallerUserId.mockResolvedValue("operator-1");
	mockCreateComputerCore.mockResolvedValue({
		id: "computer-1",
		tenant_id: "tenant-1",
	});

	resolver = await import("./createComputer.mutation.js");
});

describe("createComputer", () => {
	it("requires admin, resolves the caller, and delegates to createComputerCore", async () => {
		const result = await resolver.createComputer(
			null,
			{
				input: {
					tenantId: "tenant-1",
					ownerUserId: "user-1",
					templateId: "template-1",
					name: "Eric's Computer",
					runtimeConfig: '{"mode":"phase-one"}',
					migratedFromAgentId: "agent-1",
				},
			},
			{} as any,
		);

		expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "tenant-1");
		expect(mockResolveCallerUserId).toHaveBeenCalledTimes(1);
		expect(lastCoreInputRef.value).toMatchObject({
			tenantId: "tenant-1",
			ownerUserId: "user-1",
			templateId: "template-1",
			name: "Eric's Computer",
			runtimeConfig: '{"mode":"phase-one"}',
			migratedFromAgentId: "agent-1",
			createdBy: "operator-1",
		});
		expect(result).toEqual({ id: "computer-1", tenantId: "tenant-1" });
	});

	it("does not call createComputerCore when the admin gate rejects", async () => {
		mockRequireTenantAdmin.mockRejectedValueOnce(new Error("forbidden"));

		await expect(
			resolver.createComputer(
				null,
				{
					input: {
						tenantId: "tenant-1",
						ownerUserId: "user-1",
						templateId: "template-1",
						name: "Eric's Computer",
					},
				},
				{} as any,
			),
		).rejects.toThrow("forbidden");

		expect(mockCreateComputerCore).not.toHaveBeenCalled();
	});

	it("propagates the conflict thrown by createComputerCore (one-active invariant)", async () => {
		mockCreateComputerCore.mockRejectedValueOnce(new Error("conflict"));

		await expect(
			resolver.createComputer(
				null,
				{
					input: {
						tenantId: "tenant-1",
						ownerUserId: "user-1",
						templateId: "template-1",
						name: "Eric's Computer",
					},
				},
				{} as any,
			),
		).rejects.toThrow("conflict");
	});
});
