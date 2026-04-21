/**
 * Tests for the hardened `updateUser` resolver.
 *
 * Post-hardening semantics:
 *   - Self-edit (caller resolves to the same users.id as args.id) always allowed,
 *     regardless of tenant role. Preserves mobile settings/account.tsx.
 *   - Otherwise the caller must be `owner`/`admin` in the target's home tenant
 *     (users.tenant_id). Enforced via the shared requireTenantAdmin helper.
 *   - Target with null tenant_id can only be self-edited.
 *
 * These tests mock both the DB (for target/update) and the authz boundary
 * (requireTenantAdmin) so we can assert the resolver wires them correctly
 * without re-testing the helper itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockTargetRows,
	mockUpdateRows,
	mockResolveCaller,
	mockRequireTenantAdmin,
	selectCallRef,
} = vi.hoisted(() => ({
	mockTargetRows: vi.fn(),
	mockUpdateRows: vi.fn(),
	mockResolveCaller: vi.fn(),
	mockRequireTenantAdmin: vi.fn(),
	selectCallRef: { value: 0 },
}));

vi.mock("../graphql/utils.js", () => ({
	db: {
		select: vi.fn(() => {
			selectCallRef.value++;
			return {
				from: () => ({
					where: () => Promise.resolve(mockTargetRows() as unknown[]),
				}),
			};
		}),
		update: vi.fn(() => ({
			set: () => ({
				where: () => ({
					returning: () => Promise.resolve(mockUpdateRows() as unknown[]),
				}),
			}),
		})),
	},
	eq: (..._args: any[]) => ({ _eq: _args }),
	users: {
		id: "users.id",
		tenant_id: "users.tenant_id",
	},
	snakeToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCaller: mockResolveCaller,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
	requireTenantAdmin: mockRequireTenantAdmin,
}));

// eslint-disable-next-line import/first
import { updateUser } from "../graphql/resolvers/core/updateUser.mutation.js";

function cognitoCtx(principalId = "sub-1"): any {
	return {
		auth: {
			authType: "cognito",
			principalId,
			tenantId: null,
			email: "caller@example.com",
		},
	};
}

const sampleInput = { name: "New Name", phone: "+15551234567" };

describe("updateUser resolver — self-or-admin authz", () => {
	beforeEach(() => {
		mockTargetRows.mockReset();
		mockUpdateRows.mockReset();
		mockResolveCaller.mockReset();
		mockRequireTenantAdmin.mockReset();
		selectCallRef.value = 0;
	});

	it("allows self-edit regardless of role (mobile account screen path)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "user-1", tenantId: "tenant-1" });
		mockTargetRows.mockReturnValue([{ id: "user-1", tenant_id: "tenant-1" }]);
		mockUpdateRows.mockReturnValue([
			{ id: "user-1", tenant_id: "tenant-1", name: "New Name", phone: "+15551234567" },
		]);

		const result = await updateUser(null, { id: "user-1", input: sampleInput }, cognitoCtx());

		expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
		expect(result).toMatchObject({ id: "user-1", name: "New Name" });
	});

	it("allows admin to edit another user in the same tenant", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRows.mockReturnValue([{ id: "user-2", tenant_id: "tenant-1" }]);
		mockRequireTenantAdmin.mockResolvedValue("admin");
		mockUpdateRows.mockReturnValue([
			{ id: "user-2", tenant_id: "tenant-1", name: "New Name" },
		]);

		const result = await updateUser(null, { id: "user-2", input: sampleInput }, cognitoCtx());

		expect(mockRequireTenantAdmin).toHaveBeenCalledWith(expect.anything(), "tenant-1");
		expect(result).toMatchObject({ id: "user-2" });
	});

	it("rejects non-admin editing another user (requireTenantAdmin throws)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "user-x", tenantId: "tenant-1" });
		mockTargetRows.mockReturnValue([{ id: "user-y", tenant_id: "tenant-1" }]);
		mockRequireTenantAdmin.mockRejectedValue(
			Object.assign(new Error("Tenant admin role required"), {
				extensions: { code: "FORBIDDEN" },
			}),
		);

		await expect(
			updateUser(null, { id: "user-y", input: sampleInput }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("rejects cross-tenant admin edits (helper invoked with target's tenantId, not caller's)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-a", tenantId: "tenant-a" });
		mockTargetRows.mockReturnValue([{ id: "user-b", tenant_id: "tenant-b" }]);
		mockRequireTenantAdmin.mockRejectedValue(
			Object.assign(new Error("Tenant admin role required"), {
				extensions: { code: "FORBIDDEN" },
			}),
		);

		await expect(
			updateUser(null, { id: "user-b", input: sampleInput }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
		expect(mockRequireTenantAdmin).toHaveBeenCalledWith(expect.anything(), "tenant-b");
	});

	it("returns NOT_FOUND when target user does not exist", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRows.mockReturnValue([]);

		await expect(
			updateUser(null, { id: "missing-user", input: sampleInput }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
		expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
	});

	it("FORBIDDEN when target has null tenant_id and caller is not self", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRows.mockReturnValue([{ id: "orphan", tenant_id: null }]);

		await expect(
			updateUser(null, { id: "orphan", input: sampleInput }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
		expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
	});

	it("allows self-edit even when target has null tenant_id", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "orphan", tenantId: null });
		mockTargetRows.mockReturnValue([{ id: "orphan", tenant_id: null }]);
		mockUpdateRows.mockReturnValue([{ id: "orphan", name: "New Name" }]);

		const result = await updateUser(null, { id: "orphan", input: sampleInput }, cognitoCtx());

		expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
		expect(result).toMatchObject({ id: "orphan" });
	});

	it("FORBIDDEN when caller identity cannot be resolved (non-self path)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
		mockTargetRows.mockReturnValue([{ id: "user-1", tenant_id: "tenant-1" }]);
		mockRequireTenantAdmin.mockRejectedValue(
			Object.assign(new Error("Tenant admin role required"), {
				extensions: { code: "FORBIDDEN" },
			}),
		);

		await expect(
			updateUser(null, { id: "user-1", input: sampleInput }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});
});
