import { beforeEach, describe, expect, it, vi } from "vitest";
import { walkTenantChain } from "../src/chain";

/**
 * Stub the dynamic `pg` import via vi.mock. The real pg client never
 * runs in unit tests; we only verify the chain-walking logic against
 * a programmable cursor.
 */

const { mockClientCtor, mockCursorCtor } = vi.hoisted(() => {
	type MockChainRow = {
		event_id: string;
		event_hash: string;
		prev_hash: string | null;
	};
	type CursorState = { rows: MockChainRow[]; idx: number };
	const cursorStates = new Map<unknown, CursorState>();

	class MockCursor {
		readonly sql: string;
		readonly values: unknown[];
		constructor(sql: string, values: unknown[] = []) {
			this.sql = sql;
			this.values = values;
		}
	}

	class MockClient {
		readonly config: { connectionString: string };
		constructor(config: { connectionString: string }) {
			this.config = config;
		}
		async connect() {}
		query(
			arg: MockCursor | string,
		): MockCursor | Promise<{ rows: { tenant_id: string }[] }> {
			if (typeof arg === "string") {
				// SELECT DISTINCT tenant_id query (the "all" path).
				const rows = Array.from(mockClientCtor.fixture.keys())
					.sort()
					.map((tenant_id) => ({ tenant_id }));
				return Promise.resolve({ rows });
			}
			const tenantId = arg.values[0];
			const rows = (mockClientCtor.fixture.get(String(tenantId)) ??
				[]) as MockChainRow[];
			cursorStates.set(arg, { rows, idx: 0 });
			return arg;
		}
		async end() {}
	}

	const mockClientCtorImpl = MockClient as unknown as {
		new (config: { connectionString: string }): MockClient;
		fixture: Map<string, MockChainRow[]>;
	};
	mockClientCtorImpl.fixture = new Map<string, MockChainRow[]>();

	const mockCursorCtorImpl = Object.assign(MockCursor, {
		_cursorStates: cursorStates,
	});

	// Add read/close to MockCursor.prototype so chain.ts's
	// `cursor.read(n, cb)` / `cursor.close(cb)` work.
	(MockCursor.prototype as unknown as Record<string, unknown>).read =
		function read(
			this: MockCursor,
			n: number,
			cb: (err: Error | null, rows: MockChainRow[]) => void,
		) {
			const state = cursorStates.get(this);
			if (!state) {
				cb(null, []);
				return;
			}
			const slice = state.rows.slice(state.idx, state.idx + n);
			state.idx += slice.length;
			setImmediate(() => cb(null, slice));
		};
	(MockCursor.prototype as unknown as Record<string, unknown>).close =
		function close(this: MockCursor, cb: (err: Error | null) => void) {
			cursorStates.delete(this);
			setImmediate(() => cb(null));
		};

	return {
		mockClientCtor: mockClientCtorImpl,
		mockCursorCtor: mockCursorCtorImpl,
	};
});

vi.mock("pg", () => ({
	default: { Client: mockClientCtor, Cursor: mockCursorCtor },
	Client: mockClientCtor,
	Cursor: mockCursorCtor,
}));

const TENANT_A = "11111111-1111-7111-8111-111111111111";
const TENANT_B = "22222222-2222-7222-8222-222222222222";

beforeEach(() => {
	mockClientCtor.fixture.clear();
});

describe("walkTenantChain", () => {
	it("happy path: 3-row chain with valid prev_hash links produces no failures", async () => {
		mockClientCtor.fixture.set(TENANT_A, [
			{
				event_id: "e1",
				event_hash: "aa".repeat(32),
				prev_hash: null,
			},
			{
				event_id: "e2",
				event_hash: "bb".repeat(32),
				prev_hash: "aa".repeat(32),
			},
			{
				event_id: "e3",
				event_hash: "cc".repeat(32),
				prev_hash: "bb".repeat(32),
			},
		]);
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: [TENANT_A],
		});
		expect(failures).toEqual([]);
	});

	it("flags genesis violation: first row has non-null prev_hash", async () => {
		mockClientCtor.fixture.set(TENANT_A, [
			{
				event_id: "e1",
				event_hash: "aa".repeat(32),
				prev_hash: "ff".repeat(32),
			},
		]);
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: [TENANT_A],
		});
		expect(failures).toHaveLength(1);
		expect(failures[0].reason).toBe("non_null_genesis");
		expect(failures[0].broken_at_event_id).toBe("e1");
		expect(failures[0].tenant_id).toBe(TENANT_A);
	});

	it("flags prev_hash mismatch mid-chain", async () => {
		mockClientCtor.fixture.set(TENANT_A, [
			{
				event_id: "e1",
				event_hash: "aa".repeat(32),
				prev_hash: null,
			},
			{
				event_id: "e2",
				event_hash: "bb".repeat(32),
				prev_hash: "aa".repeat(32),
			},
			{
				event_id: "e3",
				event_hash: "cc".repeat(32),
				prev_hash: "ff".repeat(32), // WRONG — should be bb...
			},
		]);
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: [TENANT_A],
		});
		expect(failures).toHaveLength(1);
		expect(failures[0].reason).toBe("prev_hash_mismatch");
		expect(failures[0].broken_at_event_id).toBe("e3");
		expect(failures[0].expected_prev_hash).toBe("bb".repeat(32));
		expect(failures[0].actual_prev_hash).toBe("ff".repeat(32));
	});

	it("walks each tenant independently in multi-tenant scope", async () => {
		// Tenant A is clean; tenant B has a break.
		mockClientCtor.fixture.set(TENANT_A, [
			{ event_id: "a1", event_hash: "11".repeat(32), prev_hash: null },
		]);
		mockClientCtor.fixture.set(TENANT_B, [
			{ event_id: "b1", event_hash: "22".repeat(32), prev_hash: null },
			{
				event_id: "b2",
				event_hash: "33".repeat(32),
				prev_hash: "ee".repeat(32), // BROKEN
			},
		]);
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: [TENANT_A, TENANT_B],
		});
		expect(failures).toHaveLength(1);
		expect(failures[0].tenant_id).toBe(TENANT_B);
	});

	it("tenants list of [] returns no failures (no work)", async () => {
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: [],
		});
		expect(failures).toEqual([]);
	});

	it("'all' tenants resolves DISTINCT tenant_id from audit_events (catches verification-skipped tenants)", async () => {
		// Tenants A and B are present in audit_events but A's slice
		// (in some hypothetical anchor verification) failed parsing.
		// `tenants: "all"` MUST still walk both — this is the soundness
		// fix vs Plan U8 (ce-doc-review P1 #1).
		mockClientCtor.fixture.set(TENANT_A, [
			{ event_id: "a1", event_hash: "11".repeat(32), prev_hash: null },
		]);
		mockClientCtor.fixture.set(TENANT_B, [
			{ event_id: "b1", event_hash: "22".repeat(32), prev_hash: null },
			{
				event_id: "b2",
				event_hash: "33".repeat(32),
				prev_hash: "ff".repeat(32), // BROKEN
			},
		]);
		const failures = await walkTenantChain({
			dbUrl: "postgres://stub",
			tenants: "all",
		});
		// Only tenant B has a break; tenant A is clean.
		expect(failures).toHaveLength(1);
		expect(failures[0].tenant_id).toBe(TENANT_B);
	});
});
