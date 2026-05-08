/**
 * Integration: the threads(tenantId, computerId) resolver enforces per-user
 * ownership of the Computer being queried. A user with a valid Cognito JWT
 * for tenant T must NOT be able to read threads on another user's Computer
 * in the same tenant.
 *
 * Regression guard for the F1/F5 P0 findings on PR #959.
 *
 * Strategy: a full DB-backed harness for the threads resolver does not
 * exist yet, so this test stubs `db` and `resolveCallerUserId` and
 * exercises the resolver as a unit. Behavior under verification: the
 * ownership pre-flight check returns [] when the caller does not own
 * the Computer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_T = "tenant-T";
const USER_A = "user-A";
const USER_B = "user-B";

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
	owner_user_id: USER_B,
};
const A_THREADS: ThreadRow[] = [
	{ id: "t-A1", tenant_id: TENANT_T, computer_id: "computer-A", channel: "chat", created_at: new Date("2026-05-08T10:00:00Z") },
	{ id: "t-A2", tenant_id: TENANT_T, computer_id: "computer-A", channel: "chat", created_at: new Date("2026-05-08T10:05:00Z") },
];
const B_THREADS: ThreadRow[] = [
	{ id: "t-B1", tenant_id: TENANT_T, computer_id: "computer-B", channel: "chat", created_at: new Date("2026-05-08T10:10:00Z") },
];

const mocks = vi.hoisted(() => {
	const callerRef = { current: "user-A" as string | null };
	const dbState = { computers: [] as ComputerRow[], threads: [] as ThreadRow[] };

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
					(c) =>
						c.id === captured.id &&
						c.tenant_id === captured.tenant_id &&
						c.owner_user_id === captured.owner_user_id,
				);
				return match ? [{ id: match.id }] : [];
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

	const resolveCallerUserId = vi.fn(async () => callerRef.current);

	const threadToCamel = (row: ThreadRow) => ({
		id: row.id,
		tenantId: row.tenant_id,
		computerId: row.computer_id,
	});

	return {
		callerRef,
		dbState,
		eq,
		and,
		desc,
		ne,
		sql,
		db,
		resolveCallerUserId,
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

import { threads_query } from "../../src/graphql/resolvers/threads/threads.query.js";

const ctxStub = {
	auth: { authType: "cognito" as const, principalId: "principal-A" },
} as unknown as Parameters<typeof threads_query>[2];

describe("threads(tenantId, computerId) resolver — multi-user scope", () => {
	beforeEach(() => {
		mocks.callerRef.current = USER_A;
		mocks.dbState.computers = [COMPUTER_A, COMPUTER_B];
		mocks.dbState.threads = [...A_THREADS, ...B_THREADS];
		mocks.db.select.mockClear();
	});

	it("returns the caller's threads when scoped to the caller's own Computer", async () => {
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-A" },
			ctxStub,
		);
		expect(Array.isArray(result)).toBe(true);
		const ids = (result as { id: string }[]).map((r) => r.id);
		expect(ids).toEqual(["t-A2", "t-A1"]);
	});

	it("returns [] when the caller queries another user's Computer in the same tenant", async () => {
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-B" },
			ctxStub,
		);
		expect(result).toEqual([]);
	});

	it("returns [] when caller-id resolution fails", async () => {
		mocks.callerRef.current = null;
		const result = await threads_query(
			null,
			{ tenantId: TENANT_T, computerId: "computer-A" },
			ctxStub,
		);
		expect(result).toEqual([]);
	});
});
