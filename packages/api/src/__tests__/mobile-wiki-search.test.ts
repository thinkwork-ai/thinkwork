/**
 * Unit tests for the mobileWikiSearch resolver (Postgres FTS path).
 *
 * The resolver runs:
 *   1. A user-scope auth check, with legacy agent-id compatibility covered
 *      by the auth tests.
 *   2. A raw `db.execute(sql`…`)` FTS query over `wiki.pages`.
 *
 * We mock both paths so we can exercise argument handling, auth failures,
 * empty-query short-circuit, result shaping, and the regression guard that
 * Hindsight recall is never invoked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockExecute,
	mockAgentRow,
	mockResolveTenant,
	mockResolveCaller,
	mockGetMemoryServices,
} = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockAgentRow: vi.fn(),
	mockResolveTenant: vi.fn(),
	mockResolveCaller: vi.fn(),
	mockGetMemoryServices: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => {
	const chain = (rows: unknown[]) => ({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(rows),
		}),
	});
	return {
		db: {
			select: vi.fn(() => chain(mockAgentRow() as unknown[])),
			execute: mockExecute,
		},
		sql: (...xs: unknown[]) => xs,
		agents: {
			id: "agents.id",
			tenant_id: "agents.tenant_id",
			slug: "agents.slug",
		},
	};
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerTenantId: mockResolveTenant,
	resolveCaller: mockResolveCaller,
}));

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: mockGetMemoryServices,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		sql: (...xs: unknown[]) => xs,
	};
});

import { mobileWikiSearch } from "../graphql/resolvers/memory/mobileWikiSearch.query.js";
import type { GraphQLContext } from "../graphql/context.js";

function makeCtx(
	overrides: Partial<GraphQLContext["auth"]> = {},
): GraphQLContext {
	return {
		auth: {
			principalId: "user-1",
			tenantId: "t1",
			email: "eric@example.com",
			authType: "cognito",
			...overrides,
		},
	} as unknown as GraphQLContext;
}

function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "page-1",
		tenant_id: "t1",
		owner_id: "user-1",
		type: "entity",
		slug: "austin",
		title: "Austin",
		summary: "City in Texas.",
		body_md: "Austin is the capital of Texas.",
		status: "active",
		last_compiled_at: new Date("2026-04-18T12:00:00Z"),
		created_at: new Date("2026-04-01T00:00:00Z"),
		updated_at: new Date("2026-04-18T12:00:00Z"),
		score: 0.42,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockExecute.mockReset();
	mockAgentRow.mockReset();
	mockResolveTenant.mockReset();
	mockResolveCaller.mockReset();
	mockGetMemoryServices.mockReset();
	mockAgentRow.mockReturnValue([
		{ id: "agent-1", tenant_id: "t1", human_pair_id: "user-1", slug: "marco" },
	]);
	mockResolveCaller.mockResolvedValue({ userId: "user-1", tenantId: "t1" });
	mockResolveTenant.mockResolvedValue(null);
});

describe("mobileWikiSearch — empty input", () => {
	it("returns [] for empty query without hitting the db", async () => {
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "" },
			makeCtx(),
		);
		expect(out).toEqual([]);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it("returns [] for whitespace-only query", async () => {
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "   " },
			makeCtx(),
		);
		expect(out).toEqual([]);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe("mobileWikiSearch — auth", () => {
	it("throws when tenant context is missing", async () => {
		mockResolveCaller.mockResolvedValueOnce({
			userId: "user-1",
			tenantId: null,
		});
		await expect(
			mobileWikiSearch(
				{},
				{ userId: "user-1", query: "austin" },
				makeCtx({ tenantId: null }),
			),
		).rejects.toThrow(/Tenant context required/);
	});

	it("throws when legacy agent is missing or unpaired", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		await expect(
			mobileWikiSearch(
				{},
				{ tenantId: "t1", agentId: "agent-1", query: "austin" },
				makeCtx(),
			),
		).rejects.toThrow(/Agent is not paired to a user/);
	});

	it("throws when legacy agent resolves to a different user", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ id: "agent-1", tenant_id: "t1", human_pair_id: "user-other" }],
		});
		await expect(
			mobileWikiSearch(
				{},
				{ tenantId: "t1", agentId: "agent-1", query: "austin" },
				makeCtx(),
			),
		).rejects.toThrow(/user mismatch/);
	});

	it("uses resolveCaller tenant when ctx.auth.tenantId is null", async () => {
		mockResolveCaller.mockResolvedValueOnce({
			userId: "user-1",
			tenantId: "t1",
		});
		mockExecute.mockResolvedValueOnce({ rows: [] });
		const out = await mobileWikiSearch(
			{},
			{ userId: "user-1", query: "austin" },
			makeCtx({ tenantId: null }),
		);
		expect(mockResolveTenant).not.toHaveBeenCalled();
		expect(out).toEqual([]);
	});
});

describe("mobileWikiSearch — FTS path", () => {
	it("returns rows shaped as { page, score, matchingMemoryIds: [] } for happy path", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [makeRow()] });
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin" },
			makeCtx(),
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			score: 0.42,
			matchingMemoryIds: [],
		});
		expect(out[0].page).toMatchObject({
			id: "page-1",
			tenantId: "t1",
			userId: "user-1",
			ownerId: "user-1",
			type: "ENTITY",
			slug: "austin",
			title: "Austin",
			summary: "City in Texas.",
			bodyMd: "Austin is the capital of Texas.",
			status: "active",
			lastCompiledAt: "2026-04-18T12:00:00.000Z",
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-04-18T12:00:00.000Z",
			sections: [],
			aliases: [],
		});
	});

	it("preserves FTS ordering from the db (higher ts_rank first)", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [
				makeRow({ id: "p-top", slug: "austin", title: "Austin", score: 0.8 }),
				makeRow({
					id: "p-mid",
					slug: "flint-hills",
					title: "Flint Hills Austin Terminal",
					score: 0.4,
				}),
				makeRow({
					id: "p-low",
					slug: "toms-dive",
					title: "Tom's Dive & Swim",
					score: 0.05,
				}),
			],
		});
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin" },
			makeCtx(),
		);
		expect(out.map((r) => r.page.id)).toEqual(["p-top", "p-mid", "p-low"]);
	});

	it("returns [] when FTS finds no matching pages", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "zzzznothing" },
			makeCtx(),
		);
		expect(out).toEqual([]);
	});

	it("handles null `rows` shape from the driver defensively", async () => {
		mockExecute.mockResolvedValueOnce({});
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin" },
			makeCtx(),
		);
		expect(out).toEqual([]);
	});

	it("clamps limit above MAX_LIMIT (50) and below 1", async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin", limit: 9999 },
			makeCtx(),
		);
		await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin", limit: 0 },
			makeCtx(),
		);

		// Inspect the last sql-tagged-template argument block passed to db.execute.
		// sql`…${x}` is mocked to pass the interpolation args through verbatim,
		// so we can grep the flattened args for the clamped limit value.
		const allArgs = mockExecute.mock.calls.flatMap((call) => call.flat(3));
		expect(allArgs).toContain(50); // clamp of 9999
		expect(allArgs).toContain(1); // clamp of 0
	});

	it("interpolates the trimmed query into plain and prefix tsquery calls", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "  Dake's Shoppe  " },
			makeCtx(),
		);
		// The sql tag is mocked to pass its template chunks + interpolations
		// through verbatim. Flatten and stringify the whole call so we can
		// assert both that the trimmed query is bound and that the raw user
		// apostrophe stays parameterized for plainto_tsquery, while the prefix
		// query is built only from normalized safe terms.
		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("Dake's Shoppe");
		expect(flattened).not.toContain("  Dake's Shoppe  ");
		expect(flattened).toContain("plainto_tsquery");
		expect(flattened).toContain("to_tsquery");
		expect(flattened).toContain("dake:* & shoppe:*");
	});

	it("passes mobile partial input to the shared prefix FTS path", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [makeRow({ title: "Empanadas" })],
		});
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "empan" },
			makeCtx(),
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ matchingMemoryIds: [] });
		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("empan:*");
	});

	it("coerces ISO-string timestamps from raw SQL (postgres-js returns strings for db.execute)", async () => {
		// Regression guard: `db.execute(sql`…`)` returns timestamp columns as
		// ISO strings, not Date objects. `toGraphQLPage` must tolerate both,
		// otherwise GraphQL bubbles a `.toISOString is not a function` error
		// up to the field root and the client receives `mobileWikiSearch:
		// null`. This was the root cause of the empty mobile Wiki search
		// after the FTS rewrite.
		mockExecute.mockResolvedValueOnce({
			rows: [
				makeRow({
					last_compiled_at: "2026-04-18T12:00:00Z",
					created_at: "2026-04-01T00:00:00Z",
					updated_at: "2026-04-18T12:00:00Z",
				}),
			],
		});
		const out = await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin" },
			makeCtx(),
		);
		expect(out).toHaveLength(1);
		expect(out[0].page.lastCompiledAt).toBe("2026-04-18T12:00:00.000Z");
		expect(out[0].page.createdAt).toBe("2026-04-01T00:00:00.000Z");
		expect(out[0].page.updatedAt).toBe("2026-04-18T12:00:00.000Z");
	});

	it("never invokes Hindsight recall", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [makeRow()] });
		const recall = vi.fn();
		mockGetMemoryServices.mockReturnValue({ recall: { recall } });
		await mobileWikiSearch(
			{},
			{ tenantId: "t1", userId: "user-1", query: "austin" },
			makeCtx(),
		);
		expect(mockGetMemoryServices).not.toHaveBeenCalled();
		expect(recall).not.toHaveBeenCalled();
	});
});
