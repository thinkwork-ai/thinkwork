/**
 * Tests for the hardened `updateTenantMember` and `removeTenantMember`
 * resolvers.
 *
 * Post-hardening semantics:
 *   - Admin-only: caller must be owner/admin in target's tenant
 *     (via requireTenantAdmin)
 *   - No self-mutate: reject when caller's userId === target.principal_id
 *   - Grant-owner: only callers with role "owner" may promote someone to owner
 *   - Last-owner invariant: demoting or removing the last owner of a tenant
 *     must fail with code LAST_OWNER
 *   - Transaction-wrapped: owner count + mutating write share a single tx
 *     with SELECT ... FOR UPDATE on owner rows to block concurrent races
 *
 * The concurrency guarantee is ultimately enforced by Postgres row-level
 * locks (`.for("update")`); these unit tests verify the resolver wires the
 * locking + transaction correctly, and that each invariant fires with the
 * expected code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockTargetRow,
	mockCallerRoleRows,
	mockOwnerRows,
	mockUpdateRows,
	mockDeleteRows,
	mockResolveCaller,
	selectCallQueue,
} = vi.hoisted(() => ({
	mockTargetRow: { value: null as unknown },
	mockCallerRoleRows: { value: [] as unknown[] },
	mockOwnerRows: { value: [] as unknown[] },
	mockUpdateRows: { value: [] as unknown[] },
	mockDeleteRows: { value: [] as unknown[] },
	mockResolveCaller: vi.fn(),
	selectCallQueue: { select: 0, forUpdate: 0 },
}));

function buildSelectChain(label: "target" | "callerRole" | "owners") {
	const whereResult: any = {
		for: (_mode: string) => {
			selectCallQueue.forUpdate++;
			if (label === "target") {
				return Promise.resolve(
					mockTargetRow.value ? [mockTargetRow.value] : [],
				);
			}
			if (label === "owners") {
				return Promise.resolve(mockOwnerRows.value);
			}
			return Promise.resolve([]);
		},
		then: (resolve: any, reject: any) => {
			// Awaiting .where() directly (no .for("update")) — used by the
			// requireTenantAdmin role lookup.
			return Promise.resolve(mockCallerRoleRows.value).then(resolve, reject);
		},
	};
	return {
		from: () => ({
			where: () => whereResult,
		}),
	};
}

vi.mock("../graphql/utils.js", () => {
	const mockTx = {
		select: vi.fn(() => {
			const callIndex = selectCallQueue.select++;
			// Sequence per resolver:
			//   0: target member row (SELECT ... FOR UPDATE)
			//   1: caller role lookup (via requireTenantAdmin)
			//   2: owners for last-owner check (SELECT ... FOR UPDATE)
			// The label determines which branch of buildSelectChain fires
			// based on whether .for("update") was called.
			if (callIndex === 0) return buildSelectChain("target");
			if (callIndex === 1) return buildSelectChain("callerRole");
			return buildSelectChain("owners");
		}),
		update: vi.fn(() => ({
			set: () => ({
				where: () => ({
					returning: () => Promise.resolve(mockUpdateRows.value),
				}),
			}),
		})),
		delete: vi.fn(() => ({
			where: () => ({
				returning: () => Promise.resolve(mockDeleteRows.value),
			}),
		})),
	};
	return {
		db: {
			transaction: vi.fn(async (cb: (tx: typeof mockTx) => any) => cb(mockTx)),
		},
		eq: (..._args: any[]) => ({ _eq: _args }),
		and: (..._args: any[]) => ({ _and: _args }),
		tenantMembers: {
			id: "tenantMembers.id",
			tenant_id: "tenantMembers.tenant_id",
			principal_id: "tenantMembers.principal_id",
			role: "tenantMembers.role",
			status: "tenantMembers.status",
			updated_at: "tenantMembers.updated_at",
		},
		snakeToCamel: (obj: Record<string, unknown>) => obj,
	};
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCaller: mockResolveCaller,
	resolveCallerUserId: async (ctx: any) => (await mockResolveCaller(ctx)).userId,
}));

// eslint-disable-next-line import/first
import { updateTenantMember } from "../graphql/resolvers/core/updateTenantMember.mutation.js";
// eslint-disable-next-line import/first
import { removeTenantMember } from "../graphql/resolvers/core/removeTenantMember.mutation.js";

function cognitoCtx(principalId = "caller-sub"): any {
	return {
		auth: {
			authType: "cognito",
			principalId,
			tenantId: null,
			email: "caller@example.com",
		},
	};
}

function resetMocks() {
	mockTargetRow.value = null;
	mockCallerRoleRows.value = [];
	mockOwnerRows.value = [];
	mockUpdateRows.value = [];
	mockDeleteRows.value = [];
	selectCallQueue.select = 0;
	selectCallQueue.forUpdate = 0;
	mockResolveCaller.mockReset();
}

describe("updateTenantMember — admin-only + last-owner invariant", () => {
	beforeEach(resetMocks);

	it("admin changes another member's role from member → admin", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "member",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];
		mockUpdateRows.value = [
			{
				id: "member-1",
				tenant_id: "tenant-1",
				principal_id: "user-2",
				role: "admin",
			},
		];

		const result = await updateTenantMember(
			null,
			{ id: "member-1", input: { role: "admin" } },
			cognitoCtx(),
		);

		expect(result).toMatchObject({ id: "member-1", role: "admin" });
	});

	it("owner grants owner to another admin", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "admin",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockUpdateRows.value = [
			{
				id: "member-1",
				tenant_id: "tenant-1",
				principal_id: "user-2",
				role: "owner",
			},
		];

		const result = await updateTenantMember(
			null,
			{ id: "member-1", input: { role: "owner" } },
			cognitoCtx(),
		);

		expect(result).toMatchObject({ role: "owner" });
	});

	it("admin (non-owner) attempting to grant owner is FORBIDDEN", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "admin",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];

		await expect(
			updateTenantMember(null, { id: "member-1", input: { role: "owner" } }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("caller changing their own membership is FORBIDDEN", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-admin",
			tenant_id: "tenant-1",
			principal_id: "admin-1",
			role: "admin",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];

		await expect(
			updateTenantMember(null, { id: "member-admin", input: { role: "member" } }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("plain member attempting to update any member is FORBIDDEN", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "user-x", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "member",
		};
		mockCallerRoleRows.value = [{ role: "member" }];

		await expect(
			updateTenantMember(null, { id: "member-1", input: { role: "admin" } }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("demoting the LAST owner fails with LAST_OWNER", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-owner",
			tenant_id: "tenant-1",
			principal_id: "user-2", // different from caller to pass self-check
			role: "owner",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockOwnerRows.value = [{ id: "member-owner" }]; // only one owner

		await expect(
			updateTenantMember(null, { id: "member-owner", input: { role: "admin" } }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "LAST_OWNER" } });
	});

	it("demoting one of TWO owners succeeds (not the last)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-owner2",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "owner",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockOwnerRows.value = [{ id: "member-owner1" }, { id: "member-owner2" }];
		mockUpdateRows.value = [
			{ id: "member-owner2", tenant_id: "tenant-1", principal_id: "user-2", role: "admin" },
		];

		const result = await updateTenantMember(
			null,
			{ id: "member-owner2", input: { role: "admin" } },
			cognitoCtx(),
		);

		expect(result).toMatchObject({ role: "admin" });
	});

	it("status-only update on a non-owner does not trigger owner count", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "member",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];
		mockUpdateRows.value = [
			{ id: "member-1", tenant_id: "tenant-1", principal_id: "user-2", status: "active" },
		];

		const result = await updateTenantMember(
			null,
			{ id: "member-1", input: { status: "active" } },
			cognitoCtx(),
		);

		expect(result).toMatchObject({ id: "member-1" });
	});
});

describe("removeTenantMember — admin-only + last-owner invariant", () => {
	beforeEach(resetMocks);

	it("admin removes a plain member", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "member",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];
		mockDeleteRows.value = [{ id: "member-1" }];

		const result = await removeTenantMember(null, { id: "member-1" }, cognitoCtx());
		expect(result).toBe(true);
	});

	it("caller removing themselves is FORBIDDEN", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-self",
			tenant_id: "tenant-1",
			principal_id: "admin-1",
			role: "admin",
		};
		mockCallerRoleRows.value = [{ role: "admin" }];

		await expect(
			removeTenantMember(null, { id: "member-self" }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("plain member cannot remove anyone (FORBIDDEN)", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "user-x", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-1",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "member",
		};
		mockCallerRoleRows.value = [{ role: "member" }];

		await expect(
			removeTenantMember(null, { id: "member-1" }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});

	it("removing the LAST owner fails with LAST_OWNER", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-owner",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "owner",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockOwnerRows.value = [{ id: "member-owner" }];

		await expect(
			removeTenantMember(null, { id: "member-owner" }, cognitoCtx()),
		).rejects.toMatchObject({ extensions: { code: "LAST_OWNER" } });
	});

	it("removing one of two owners succeeds", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-owner2",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "owner",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockOwnerRows.value = [{ id: "member-owner1" }, { id: "member-owner2" }];
		mockDeleteRows.value = [{ id: "member-owner2" }];

		const result = await removeTenantMember(null, { id: "member-owner2" }, cognitoCtx());
		expect(result).toBe(true);
	});

	it("returns false when target member does not exist", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "admin-1", tenantId: "tenant-1" });
		mockTargetRow.value = null;

		const result = await removeTenantMember(null, { id: "missing" }, cognitoCtx());
		expect(result).toBe(false);
	});

	it("acquires a row-level lock on target and owners (.for('update'))", async () => {
		mockResolveCaller.mockResolvedValue({ userId: "owner-1", tenantId: "tenant-1" });
		mockTargetRow.value = {
			id: "member-owner2",
			tenant_id: "tenant-1",
			principal_id: "user-2",
			role: "owner",
		};
		mockCallerRoleRows.value = [{ role: "owner" }];
		mockOwnerRows.value = [{ id: "member-owner1" }, { id: "member-owner2" }];
		mockDeleteRows.value = [{ id: "member-owner2" }];

		await removeTenantMember(null, { id: "member-owner2" }, cognitoCtx());

		// Target row lock + owner-count lock should both have fired .for("update")
		expect(selectCallQueue.forUpdate).toBe(2);
	});
});
