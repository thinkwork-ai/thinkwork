import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockSelect,
	mockInsert,
	mockCreateComputerCore,
	lastActivityLogValuesRef,
	templateLookupRef,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockInsert: vi.fn(),
	mockCreateComputerCore: vi.fn(),
	lastActivityLogValuesRef: { value: null as Record<string, unknown> | null },
	templateLookupRef: {
		// Default: platform-default template is seeded.
		value: [{ id: "tpl-platform" }] as Array<{ id: string }>,
	},
}));

vi.mock("../../graphql/utils.js", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => Promise.resolve(templateLookupRef.value),
			}),
		}),
		insert: (table: unknown) => {
			// Capture the activity_log insert; createComputerCore's insert is not
			// reached because we mock the createComputerCore function itself.
			return {
				values: (v: Record<string, unknown>) => {
					lastActivityLogValuesRef.value = v;
					return Promise.resolve();
				},
			};
		},
	},
	activityLog: { __name: "activity_log" },
	agentTemplates: {
		id: "agent_templates.id",
		slug: "agent_templates.slug",
		tenant_id: "agent_templates.tenant_id",
		template_kind: "agent_templates.template_kind",
	},
	and: vi.fn((...parts: unknown[]) => ({ kind: "and", parts })),
	eq: vi.fn((left: unknown, right: unknown) => ({
		kind: "eq",
		left,
		right,
	})),
	isNull: vi.fn((col: unknown) => ({ kind: "isNull", col })),
}));

vi.mock("../../graphql/resolvers/computers/shared.js", () => ({
	createComputerCore: (...args: unknown[]) => mockCreateComputerCore(...args),
}));

let helper: typeof import("./provision.js");

beforeEach(async () => {
	vi.resetModules();
	mockSelect.mockReset();
	mockInsert.mockReset();
	mockCreateComputerCore.mockReset();
	lastActivityLogValuesRef.value = null;
	templateLookupRef.value = [{ id: "tpl-platform" }];

	mockCreateComputerCore.mockResolvedValue({
		id: "computer-1",
		tenant_id: "tenant-1",
		owner_user_id: "user-1",
	});

	helper = await import("./provision.js");
});

describe("provisionComputerForMember", () => {
	it("creates a Computer on the happy path", async () => {
		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
			adminUserId: "admin-1",
		});

		expect(result.status).toBe("created");
		if (result.status === "created") {
			expect(result.computerId).toBe("computer-1");
		}
		expect(mockCreateComputerCore).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "tenant-1",
				ownerUserId: "user-1",
				templateId: "tpl-platform",
				createdBy: "admin-1",
			}),
		);
		expect(lastActivityLogValuesRef.value).toBeNull();
	});

	it("skips non-USER principals immediately without DB calls", async () => {
		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "team-1",
			principalType: "team",
			callSite: "addTenantMember",
		});

		expect(result).toEqual({ status: "skipped", reason: "not_user_principal" });
		expect(mockCreateComputerCore).not.toHaveBeenCalled();
		expect(lastActivityLogValuesRef.value).toBeNull();
	});

	it("accepts both 'USER' and 'user' principalType casings", async () => {
		const upperResult = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "USER",
			callSite: "inviteMember",
		});
		expect(upperResult.status).toBe("created");
	});

	it("treats the assertNoActiveComputer GraphQLError CONFLICT as skipped:already_active", async () => {
		mockCreateComputerCore.mockRejectedValueOnce(
			new GraphQLError("User already has an active Computer", {
				extensions: { code: "CONFLICT" },
			}),
		);

		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
		});

		expect(result).toEqual({ status: "skipped", reason: "already_active" });
		expect(lastActivityLogValuesRef.value).toBeNull();
	});

	it("treats Postgres 23505 (race-loss) as skipped:already_active", async () => {
		// Drizzle wraps pg errors; simulate the wrapped shape too.
		const pgErr: any = new Error("duplicate key value violates unique constraint");
		pgErr.code = "23505";
		mockCreateComputerCore.mockRejectedValueOnce(pgErr);

		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
		});

		expect(result).toEqual({ status: "skipped", reason: "already_active" });
		expect(lastActivityLogValuesRef.value).toBeNull();
	});

	it("treats nested Postgres 23505 (cause.code) as skipped:already_active", async () => {
		const wrappedErr: any = new Error("insert failed");
		wrappedErr.cause = { code: "23505" };
		mockCreateComputerCore.mockRejectedValueOnce(wrappedErr);

		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
		});

		expect(result.status).toBe("skipped");
	});

	it("returns failed:no_default_template when the platform default is missing and writes an activity_log row", async () => {
		templateLookupRef.value = [];

		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
			adminUserId: "admin-1",
		});

		expect(result.status).toBe("failed");
		if (result.status === "failed") {
			expect(result.reason).toBe("no_default_template");
		}
		expect(mockCreateComputerCore).not.toHaveBeenCalled();
		expect(lastActivityLogValuesRef.value).toMatchObject({
			tenant_id: "tenant-1",
			actor_type: "user",
			actor_id: "admin-1",
			action: "computer_auto_provision_failed",
			entity_type: "user",
			entity_id: "user-1",
		});
	});

	it("uses SYSTEM_ACTOR_ID for bootstrapUser-path activity_log rows", async () => {
		templateLookupRef.value = [];

		await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-new",
			principalType: "user",
			callSite: "bootstrapUser",
		});

		expect(lastActivityLogValuesRef.value).toMatchObject({
			actor_type: "system",
			actor_id: helper.SYSTEM_ACTOR_ID,
		});
	});

	it("captures unknown errors as failed:unknown with the error message", async () => {
		mockCreateComputerCore.mockRejectedValueOnce(new Error("database unreachable"));

		const result = await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
		});

		expect(result.status).toBe("failed");
		if (result.status === "failed") {
			expect(result.reason).toBe("unknown");
			expect(result.message).toContain("database unreachable");
		}
		expect(lastActivityLogValuesRef.value).toMatchObject({
			action: "computer_auto_provision_failed",
		});
	});

	it("never throws even when the underlying insert path rejects unexpectedly", async () => {
		mockCreateComputerCore.mockRejectedValueOnce(new Error("kaboom"));

		await expect(
			helper.provisionComputerForMember({
				tenantId: "tenant-1",
				userId: "user-1",
				principalType: "user",
				callSite: "addTenantMember",
			}),
		).resolves.toMatchObject({ status: "failed" });
	});

	it("passes through an explicit templateId override without resolving the default", async () => {
		await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-1",
			principalType: "user",
			callSite: "addTenantMember",
			templateId: "tpl-tenant-override",
		});

		expect(mockCreateComputerCore).toHaveBeenCalledWith(
			expect.objectContaining({ templateId: "tpl-tenant-override" }),
		);
	});

	it("passes createdBy=null for bootstrapUser callSite", async () => {
		await helper.provisionComputerForMember({
			tenantId: "tenant-1",
			userId: "user-new",
			principalType: "user",
			callSite: "bootstrapUser",
			adminUserId: "should-be-ignored",
		});

		expect(mockCreateComputerCore).toHaveBeenCalledWith(
			expect.objectContaining({ createdBy: null }),
		);
	});
});
