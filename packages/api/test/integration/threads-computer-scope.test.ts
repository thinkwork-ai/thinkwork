/**
 * Integration: the threads(tenantId, computerId) resolver enforces per-user
 * ownership of the Computer being queried, with bypasses for tenant admins
 * (so admin's Computer detail page keeps working) and apikey callers
 * (service-to-service trust boundary).
 *
 * Regression guard for the F1/F5 P0 findings on PR #959 plus the AC-001
 * admin-operator regression flagged on PR #962's review.
 *
 * Strategy: stub `db` plus the `requireComputerReadAccess` helper from
 * computers/shared. The helper already encodes owner-OR-tenant-admin and
 * is unit-tested in its own surface; here we only verify that the
 * threads resolver consults it correctly and that the apikey path bypasses.
 */

import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_T = "tenant-T";
const USER_A = "user-A";

interface ComputerRow {
	id: string;
	tenant_id: string;
	owner_user_id: string;
}

interface ThreadRow {
	id: string;
	tenant_id: string;
	computer_id: string;
	channel: string;
	created_at: Date;
}

const COMPUTER_A: ComputerRow = {
	id: "computer-A",
	tenant_id: TENANT_T,
	owner_user_id: USER_A,
};
const COMPUTER_B: ComputerRow = {
	id: "computer-B",
	tenant_id: TENANT_T,
	owner_user_id: "user-B",
};
const A_THREADS: ThreadRow[] = [
	{ id: "t-A1", tenant_id: TENANT_T, computer_id: "computer-A", channel: "chat", created_at: new Date("2026-05-08T10:00:00Z") },
	{ id: "t-A2", tenant_id: TENANT_T, computer_id: "computer-A", channel: "chat", created_at: new Date("2026-05-08T10:05:00Z") },
];
const B_THREADS: ThreadRow[] = [
	{ id: "t-B1", tenant_id: TENANT_T, computer_id: "computer-B", channel: "chat", created_at: new Date("2026-05-08T10:10:00Z") },
];

const mocks = vi.hoisted(() => {
	const dbState = { computers: [] as ComputerRow[], threads: [] as ThreadRow[] };
	// Set per-test: throw to deny, return undefined to allow.
	const accessCheckImpl = { current: (async () => undefined) as (computer: ComputerRow) => Promise<void> };

	function harvestEqs(predicate: unknown): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		function walk(node: unknown) {
			if (!node || typeof node !== "object") return;
			const obj = node as { _op?: string; preds?: unknown[]; column?: { _name?: string }; value?: unknown };
			if (obj._op === "and" && Array.isArray(obj.preds)) {
				for (const p of obj.preds) walk(p);
			}
			if (obj._op === "eq" && obj.column && (obj.column as { _name?: string })._name) {
				const name = (obj.column as { _name: string })._name;
				const short = name.split(".")[1];
				if (short !== undefined) out[short] = obj.value;
			}
		}
		walk(predicate);
		return out;
	}

	const eq = vi.fn((column: { _name?: string } | unknown, value: unknown) => ({ _op: "eq", column, value }));
	const and = vi.fn((...preds: unknown[]) => ({ _op: "and", preds }));
	const desc = vi.fn((column: unknown) => ({ _op: "desc", column }));
	const ne = vi.fn((column: unknown, value: unknown) => ({ _op: "ne", column, value }));
	const sql = vi.fn(() => ({ _op: "sql" }));

	const computersTable = {
		_name: "computers",
		id: { _name: "computers.id" },
		tenant_id: { _name: "computers.tenant_id" },
		owner_user_id: { _name: "computers.owner_user_id" },
		status: { _name: "computers.status" },
	};
	const threadsTable = {
		_name: "threads",
		tenant_id: { _name: "threads.tenant_id" },
		computer_id: { _name: "threads.computer_id" },
		agent_id: { _name: "threads.agent_id" },
		assignee_id: { _name: "threads.assignee_id" },
		status: { _name: "threads.status" },
		channel: { _name: "threads.channel" },
		created_at: { _name: "threads.created_at" },
	};

	function buildSelect(table: { _name?: string }) {
		const tableName = table?._name ?? "";
		const isComputers = tableName.includes("computers");
		let captured: Record<string, unknown> = {};

		const builder: Record<string, unknown> = {
			from: () => builder,
			where(predicate: unknown) {
				captured = harvestEqs(predicate);
				return builder;
			},
			orderBy() {
				return builder;
			},
			async limit() {
				return resolveRows();
			},
			then(onFulfilled: (rows: unknown[]) => unknown) {
				return Promise.resolve(resolveRows()).then(onFulfilled);
			},
		};

		function resolveRows(): unknown[] {
			if (isComputers) {
				const match = dbState.computers.find(
					(c) => c.id === captured.id && c.tenant_id === captured.tenant_id,
				);
				return match ? [match] : [];
			}
			let rows = dbState.threads.filter((r) => r.tenant_id === captured.tenant_id);
			if (captured.computer_id) rows = rows.filter((r) => r.computer_id === captured.computer_id);
			rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
			return rows;
		}

		return builder;
	}

	const db = {
		select: vi.fn(() => ({ from: buildSelect })),
	};

	const resolveCallerUserId = vi.fn(async () => USER_A as string | null);
	const requireComputerReadAccess = vi.fn(async (_ctx: unknown, computer: ComputerRow) => {
		await accessCheckImpl.current(computer);
	});

	const threadToCamel = (row: ThreadRow) => ({
		id: row.id,
		tenantId: row.tenant_id,
		computerId: row.computer_id,
	});

	return {
		dbState,
		accessCheckImpl,
		eq,
		and,
		desc,
		ne,
		sql,
		db,
		resolveCallerUserId,
		requireComputerReadAccess,
		threadToCamel,
		computersTable,
		threadsTable,
	};
});

vi.mock("../../src/graphql/utils.js", () => ({
	db: mocks.db,
	eq: mocks.eq,
	and: mocks.and,
	desc: mocks.desc,
	ne: mocks.ne,
	sql: mocks.sql,
	threads: mocks.threadsTable,
	computers: mocks.computersTable,
	threadToCamel: mocks.threadToCamel,
}));

vi.mock("../../src/graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("../../src/graphql/resolvers/computers/shared.js", () => ({
	requireComputerReadAccess: mocks.requireComputerReadAccess,
}));

import { threads_query } from "../../src/graphql/resolvers/threads/threads.query.js";

const cognitoCtx = {
	auth: { authType: "cognito" as const, principalId: "principal-A" },
} as unknown as Parameters<typeof threads_query>[2];

const apikeyCtx = {
	auth: { authType: "apikey" as const, principalId: "service-x" },
} as unknown as Parameters<typeof threads_query>[2];

describe("threads(tenantId, computerId) resolver — multi-user scope", () => {
	beforeEach(() => {
		mocks.dbState.computers = [COMPUTER_A, COMPUTER_B];
		mocks.dbState.threads = [...A_THREADS, ...B_THREADS];
		mocks.accessCheckImpl.current = async () => undefined; // allow by default
		mocks.db.select.mockClear();
		mocks.requireComputerReadAccess.mockClear();
	});

	it("returns the caller's threads when scoped to the caller's own Computer", async () => {
		// Owner-allow: requireComputerReadAccess does not throw.
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-A" },
			cognitoCtx,
		);
		const ids = (result as { id: string }[]).map((r) => r.id);
		expect(ids).toEqual(["t-A2", "t-A1"]);
		// Verifies the resolver actually consulted the access helper.
		expect(mocks.requireComputerReadAccess).toHaveBeenCalledTimes(1);
	});

	it("returns [] when requireComputerReadAccess throws (non-owner non-admin)", async () => {
		mocks.accessCheckImpl.current = async () => {
			throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
		};
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-B" },
			cognitoCtx,
		);
		expect(result).toEqual([]);
	});

	it("allows admin operators to read any tenant Computer's threads (admin-bypass via requireComputerReadAccess)", async () => {
		// Admin scenario: requireComputerReadAccess succeeds even though the
		// caller is not the Computer's owner. The real helper does this via
		// requireTenantAdmin; here we just simulate the success path.
		mocks.accessCheckImpl.current = async () => undefined;
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-B" },
			cognitoCtx,
		);
		const ids = (result as { id: string }[]).map((r) => r.id);
		expect(ids).toEqual(["t-B1"]);
	});

	it("returns [] when the queried Computer doesn't exist (or wrong tenant)", async () => {
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "nonexistent-computer" },
			cognitoCtx,
		);
		expect(result).toEqual([]);
		// Did not even reach the access check — short-circuits on missing row.
		expect(mocks.requireComputerReadAccess).not.toHaveBeenCalled();
	});

	it("apikey callers bypass the ownership gate entirely (service-to-service trust)", async () => {
		// Even if the access helper would deny, apikey callers skip it.
		mocks.accessCheckImpl.current = async () => {
			throw new GraphQLError("Forbidden");
		};
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-B" },
			apikeyCtx,
		);
		const ids = (result as { id: string }[]).map((r) => r.id);
		expect(ids).toEqual(["t-B1"]);
		expect(mocks.requireComputerReadAccess).not.toHaveBeenCalled();
	});
});
