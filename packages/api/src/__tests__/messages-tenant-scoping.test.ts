/**
 * Plan-012 U7 — tenant scoping audit + regression test for Message.parts.
 *
 * Closes a pre-existing P0-level cross-tenant exposure: prior to U7, both
 * the Query.messages resolver and the Thread.messages field resolver
 * filtered by `thread_id` (or `messages.thread_id`) alone, with no
 * tenant gate. Adding `Message.parts` (which carries tool input/output
 * and reasoning content per contract v1) made fixing this gap
 * non-negotiable — `parts` exposure must not widen blast radius.
 *
 * What this test pins:
 *   1. Query.messages: a caller from tenant B requesting messages from a
 *      thread owned by tenant A receives an empty page (no rows leaked).
 *   2. Query.messages: a caller from tenant A requesting their own
 *      thread sees the rows including the new `parts` field.
 *   3. Thread.messages field resolver: rows are filtered by
 *      `thread.tenantId` so a defense-in-depth gate fires even if an
 *      upstream resolver mis-routed.
 *
 * Implementation: drizzle's chainable query builder is mocked to return
 * fixture rows. We don't hit Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface ThreadRow {
	id: string;
	tenant_id: string;
}

interface MessageRow {
	id: string;
	thread_id: string;
	tenant_id: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string | null;
	parts: unknown;
	created_at: Date;
}

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THREAD_A = "11111111-1111-4111-8111-111111111111";

const tableMarker = (name: string) => ({ __table__: name });

const {
	mockDb,
	mockResolveCaller,
	threadFixtures,
	messageFixtures,
} = vi.hoisted(() => {
	const threadFixtures: ThreadRow[] = [];
	const messageFixtures: MessageRow[] = [];

	const mockResolveCaller = vi.fn(async (ctx: any) => ({
		tenantId: ctx?.auth?.tenantId ?? null,
		userId: ctx?.auth?.principalId ?? null,
	}));

	function selectBuilderForTable(table: string) {
		let lastConditions: any[] = [];
		const chain: any = {
			from: vi.fn((_t: any) => chain),
			where: vi.fn((cond: any) => {
				lastConditions = Array.isArray(cond) ? cond : [cond];
				return chain;
			}),
			orderBy: vi.fn(() => chain),
			limit: vi.fn(async () => {
				if (table === "threads") {
					// The Query.messages resolver looks up the thread row
					// scoped by id AND tenant_id; threadFixtures is the
					// fixture set the test populates.
					return threadFixtures.filter((t) =>
						lastConditions.every((c) => c?.match?.(t) !== false),
					);
				}
				if (table === "messages") {
					return messageFixtures.filter((m) =>
						lastConditions.every((c) => c?.match?.(m) !== false),
					);
				}
				return [];
			}),
		};
		return chain;
	}

	const mockDb = {
		select: vi.fn((columns?: any) => {
			// Heuristic: when called with `db.select().from(threads)` the
			// caller passes thread/messages tableMarkers. We thread the
			// table identity through `from`.
			let table = "unknown";
			const builder: any = {
				from: vi.fn((t: any) => {
					table = t?.__table__ ?? "unknown";
					return inner;
				}),
			};
			let lastConditions: any[] = [];
			const inner: any = {
				where: vi.fn((cond: any) => {
					lastConditions = Array.isArray(cond) ? cond : [cond];
					return inner;
				}),
				orderBy: vi.fn(() => inner),
				limit: vi.fn(async () => {
					if (table === "threads") {
						return threadFixtures.filter((t) =>
							lastConditions.every((c) => c?.match?.(t) !== false),
						);
					}
					if (table === "messages") {
						return messageFixtures.filter((m) =>
							lastConditions.every((c) => c?.match?.(m) !== false),
						);
					}
					return [];
				}),
			};
			// also support direct iteration for tiny destructuring patterns
			// like `const [row] = await db.select()...where(...)` — vitest
			// awaits the chain; we handle await by returning a thenable
			// from `where`.
			(inner as any).then = (resolve: any) => {
				if (table === "threads") {
					resolve(
						threadFixtures.filter((t) =>
							lastConditions.every((c) => c?.match?.(t) !== false),
						),
					);
				} else if (table === "messages") {
					resolve(
						messageFixtures.filter((m) =>
							lastConditions.every((c) => c?.match?.(m) !== false),
						),
					);
				} else {
					resolve([]);
				}
			};
			return builder;
		}),
	};

	return {
		mockDb,
		mockResolveCaller,
		threadFixtures,
		messageFixtures,
	};
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCaller: mockResolveCaller,
	resolveCallerTenantId: vi.fn(async (ctx: any) => {
		const { tenantId } = await mockResolveCaller(ctx);
		return tenantId;
	}),
}));

// Provide fake drizzle helpers that capture the predicate as a callable
// `match` function so the in-memory fixtures can filter against it.
type Predicate = { match: (row: Record<string, unknown>) => boolean };

function eqPredicate(column: any, value: unknown): Predicate {
	const colName = typeof column?.__column__ === "string" ? column.__column__ : "";
	return {
		match: (row) => row[colName] === value,
	};
}

function andPredicate(...preds: Predicate[]): Predicate {
	return {
		match: (row) => preds.every((p) => p.match(row)),
	};
}

function ltPredicate(_col: any, _val: unknown): Predicate {
	// We don't exercise cursor pagination in these tests; treat as always
	// true so it doesn't filter rows.
	return { match: () => true };
}

function descColumn(_col: any) {
	return null;
}

vi.mock("../graphql/utils.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../graphql/utils.js")>();
	return {
		...actual,
		db: mockDb,
		eq: eqPredicate,
		and: andPredicate,
		desc: descColumn,
		lt: ltPredicate,
		messages: {
			...tableMarker("messages"),
			thread_id: { __column__: "thread_id" },
			tenant_id: { __column__: "tenant_id" },
			created_at: { __column__: "created_at" },
		},
		threads: {
			...tableMarker("threads"),
			id: { __column__: "id" },
			tenant_id: { __column__: "tenant_id" },
		},
		messageToCamel: (row: Record<string, unknown>) => ({
			id: row.id,
			threadId: row.thread_id,
			tenantId: row.tenant_id,
			role:
				typeof row.role === "string"
					? (row.role as string).toUpperCase()
					: row.role,
			content: row.content,
			parts:
				row.parts && typeof row.parts === "object"
					? JSON.stringify(row.parts)
					: (row.parts as unknown),
			createdAt:
				row.created_at instanceof Date
					? (row.created_at as Date).toISOString()
					: row.created_at,
		}),
	};
});

beforeEach(() => {
	threadFixtures.length = 0;
	messageFixtures.length = 0;
	mockResolveCaller.mockClear();
});

describe("Query.messages — tenant scoping (plan-012 U7)", () => {
	it("returns rows when caller's tenant owns the thread", async () => {
		threadFixtures.push({ id: THREAD_A, tenant_id: TENANT_A });
		messageFixtures.push({
			id: "msg-1",
			thread_id: THREAD_A,
			tenant_id: TENANT_A,
			role: "assistant",
			content: "Hello",
			parts: [{ type: "text", text: "Hello" }],
			created_at: new Date("2026-05-09T00:00:00Z"),
		});

		const { messages_ } = await import(
			"../graphql/resolvers/messages/messages.query.js"
		);

		const result = await messages_(
			null,
			{ threadId: THREAD_A },
			{ auth: { tenantId: TENANT_A, principalId: "u-1" } } as any,
		);

		expect(result.edges).toHaveLength(1);
		expect(result.edges[0].node.parts).toEqual(
			JSON.stringify([{ type: "text", text: "Hello" }]),
		);
		expect(result.edges[0].node.tenantId).toBe(TENANT_A);
	});

	it("returns an empty page when caller's tenant does NOT own the thread (P0 cross-tenant gate)", async () => {
		threadFixtures.push({ id: THREAD_A, tenant_id: TENANT_A });
		messageFixtures.push({
			id: "msg-secret",
			thread_id: THREAD_A,
			tenant_id: TENANT_A,
			role: "assistant",
			content: "secret",
			parts: [{ type: "tool-renderFragment", input: { tsx: "<X />" } }],
			created_at: new Date("2026-05-09T00:00:00Z"),
		});

		const { messages_ } = await import(
			"../graphql/resolvers/messages/messages.query.js"
		);

		const result = await messages_(
			null,
			{ threadId: THREAD_A },
			{ auth: { tenantId: TENANT_B, principalId: "u-foreign" } } as any,
		);

		expect(result).toEqual({
			edges: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		});
	});

	it("returns an empty page when caller has no resolvable tenant (Google-federated user pre-pre-token-trigger)", async () => {
		threadFixtures.push({ id: THREAD_A, tenant_id: TENANT_A });
		messageFixtures.push({
			id: "msg-1",
			thread_id: THREAD_A,
			tenant_id: TENANT_A,
			role: "assistant",
			content: "hi",
			parts: null,
			created_at: new Date("2026-05-09T00:00:00Z"),
		});

		const { messages_ } = await import(
			"../graphql/resolvers/messages/messages.query.js"
		);

		const result = await messages_(
			null,
			{ threadId: THREAD_A },
			{ auth: {} } as any,
		);

		expect(result.edges).toEqual([]);
	});
});

describe("Thread.messages field resolver — tenant scoping (plan-012 U7)", () => {
	it("filters messages by thread.tenantId (defense-in-depth)", async () => {
		messageFixtures.push(
			{
				id: "msg-A",
				thread_id: THREAD_A,
				tenant_id: TENANT_A,
				role: "assistant",
				content: "tenant-A only",
				parts: null,
				created_at: new Date("2026-05-09T00:00:00Z"),
			},
			{
				id: "msg-B",
				thread_id: THREAD_A,
				tenant_id: TENANT_B,
				role: "assistant",
				content: "tenant-B only — should never leak",
				parts: null,
				created_at: new Date("2026-05-09T00:00:01Z"),
			},
		);

		const { threadTypeResolvers } = await import(
			"../graphql/resolvers/threads/types.js"
		);

		const result = await threadTypeResolvers.messages(
			{ id: THREAD_A, tenantId: TENANT_A },
			{},
			{ auth: { tenantId: TENANT_A, principalId: "u-1" } } as any,
		);

		const ids = result.edges.map((e: any) => e.node.id);
		expect(ids).toEqual(["msg-A"]);
		expect(ids).not.toContain("msg-B");
	});

	it("falls back to thread_id-only filter when thread row carries no tenantId (back-compat)", async () => {
		messageFixtures.push({
			id: "msg-X",
			thread_id: THREAD_A,
			tenant_id: TENANT_A,
			role: "assistant",
			content: "back-compat",
			parts: null,
			created_at: new Date("2026-05-09T00:00:00Z"),
		});

		const { threadTypeResolvers } = await import(
			"../graphql/resolvers/threads/types.js"
		);

		const result = await threadTypeResolvers.messages(
			{ id: THREAD_A }, // no tenantId on parent
			{},
			{} as any,
		);

		expect(result.edges.map((e: any) => e.node.id)).toEqual(["msg-X"]);
	});
});
