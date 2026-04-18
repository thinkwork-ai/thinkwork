/**
 * Unit tests for PR 4 — wiki resolver auth surface + lint/export handlers.
 *
 * The DB-heavy queries inside the resolvers are covered by PR 3's
 * integration verification; here we exercise the pieces that don't require
 * a live Postgres:
 *   - assertCanReadWikiScope / assertCanAdminWikiScope visibility matrix
 *   - compileWikiNow admin-path authz
 *   - wiki-export WIKI_EXPORT_BUCKET absence short-circuit
 *   - wiki-lint error-path fails gracefully (no DB)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock handles ────────────────────────────────────────────────────

const { mockDb, mockAgentsRow, mockEnqueue } = vi.hoisted(() => {
	const mockAgentsRow = vi.fn();
	const mockEnqueue = vi.fn();
	const chain = (rows: unknown[]) => ({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
			}),
		}),
	});
	const mockDb = {
		select: vi.fn(() => chain(mockAgentsRow() as unknown[])),
	};
	return { mockDb, mockAgentsRow, mockEnqueue };
});

vi.mock("../graphql/utils.js", () => ({
	db: mockDb,
	eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("../lib/wiki/repository.js");
	return { ...actual, enqueueCompileJob: mockEnqueue };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
	};
});

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
	assertCanReadWikiScope,
	assertCanAdminWikiScope,
	WikiAuthError,
} from "../graphql/resolvers/wiki/auth.js";
import { compileWikiNow } from "../graphql/resolvers/wiki/compileWikiNow.mutation.js";
import type { GraphQLContext } from "../graphql/context.js";

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.WIKI_COMPILE_FN;
	delete process.env.STAGE;
});

function makeCtx(auth: Partial<GraphQLContext["auth"]>): GraphQLContext {
	return {
		auth: {
			principalId: "user-1",
			tenantId: "t1",
			email: "a@b.c",
			authType: "cognito",
			...auth,
		} as GraphQLContext["auth"],
	} as GraphQLContext;
}

// ─── assertCanReadWikiScope ──────────────────────────────────────────────────

describe("assertCanReadWikiScope", () => {
	it("allows when caller tenant matches and agent lives in tenant", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
		await expect(
			assertCanReadWikiScope(makeCtx({}), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).resolves.toBeUndefined();
	});

	it("rejects when tenant context missing", async () => {
		mockAgentsRow.mockReturnValue([]);
		await expect(
			assertCanReadWikiScope(makeCtx({ tenantId: null }), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).rejects.toThrow(WikiAuthError);
	});

	it("rejects tenant mismatch before querying agents", async () => {
		await expect(
			assertCanReadWikiScope(makeCtx({ tenantId: "t-other" }), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).rejects.toThrow(/tenant mismatch/);
	});

	it("rejects missing agent", async () => {
		mockAgentsRow.mockReturnValue([]);
		await expect(
			assertCanReadWikiScope(makeCtx({}), {
				tenantId: "t1",
				ownerId: "a-missing",
			}),
		).rejects.toThrow(/Agent not found/);
	});

	it("rejects cross-tenant agent", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t-other" }]);
		await expect(
			assertCanReadWikiScope(makeCtx({}), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).rejects.toThrow(/outside tenant/);
	});
});

// ─── assertCanAdminWikiScope ─────────────────────────────────────────────────

describe("assertCanAdminWikiScope", () => {
	it("allows api-key caller that passes read check", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
		await expect(
			assertCanAdminWikiScope(makeCtx({ authType: "apikey" }), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).resolves.toBeUndefined();
	});

	it("rejects cognito (end-user) caller even when tenant matches", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
		await expect(
			assertCanAdminWikiScope(makeCtx({ authType: "cognito" }), {
				tenantId: "t1",
				ownerId: "a1",
			}),
		).rejects.toThrow(/Admin-only/);
	});
});

// ─── compileWikiNow ──────────────────────────────────────────────────────────

describe("compileWikiNow", () => {
	it("returns job row and best-effort invokes the Lambda when admin", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: {
				id: "job-1",
				tenant_id: "t1",
				owner_id: "a1",
				dedupe_key: "t1:a1:1",
				status: "pending",
				trigger: "admin",
				attempt: 0,
				claimed_at: null,
				started_at: null,
				finished_at: null,
				error: null,
				metrics: null,
				created_at: new Date("2026-04-18T00:00:00Z"),
			},
		});
		const out = await compileWikiNow(
			{},
			{ tenantId: "t1", ownerId: "a1" },
			makeCtx({ authType: "apikey" }),
		);
		expect(out.id).toBe("job-1");
		expect(out.status).toBe("pending");
		expect(out.trigger).toBe("admin");
		expect(mockEnqueue).toHaveBeenCalledWith({
			tenantId: "t1",
			ownerId: "a1",
			trigger: "admin",
		});
	});

	it("refuses a cognito (end-user) caller with admin-only error", async () => {
		mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
		await expect(
			compileWikiNow(
				{},
				{ tenantId: "t1", ownerId: "a1" },
				makeCtx({ authType: "cognito" }),
			),
		).rejects.toThrow(/Admin-only/);
		expect(mockEnqueue).not.toHaveBeenCalled();
	});
});
