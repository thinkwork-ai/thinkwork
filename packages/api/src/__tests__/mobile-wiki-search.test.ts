/**
 * Unit tests for the mobileWikiSearch resolver (Postgres FTS path).
 *
 * The resolver runs:
 *   1. A drizzle `db.select(...).from(agents).where(eq(agents.id, id))` to
 *      auth-check the agent against the caller's tenant.
 *   2. A raw `db.execute(sql`…`)` FTS query over `wiki_pages`.
 *
 * We mock both paths so we can exercise argument handling, auth failures,
 * empty-query short-circuit, result shaping, and the regression guard that
 * Hindsight recall is never invoked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute, mockAgentRow, mockResolveTenant, mockGetMemoryServices } =
	vi.hoisted(() => ({
		mockExecute: vi.fn(),
		mockAgentRow: vi.fn(),
		mockResolveTenant: vi.fn(),
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
		agents: {
			id: "agents.id",
			tenant_id: "agents.tenant_id",
			slug: "agents.slug",
		},
	};
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerTenantId: mockResolveTenant,
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

function makeCtx(overrides: Partial<GraphQLContext["auth"]> = {}): GraphQLContext {
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
		owner_id: "agent-1",
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
	mockAgentRow.mockReturnValue([
		{ id: "agent-1", tenant_id: "t1", slug: "marco" },
	]);
	mockResolveTenant.mockResolvedValue(null);
});

describe("mobileWikiSearch — empty input", () => {
	it("returns [] for empty query without hitting the db", async () => {
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "" },
			makeCtx(),
		);
		expect(out).toEqual([]);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it("returns [] for whitespace-only query", async () => {
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "   " },
			makeCtx(),
		);
		expect(out).toEqual([]);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe("mobileWikiSearch — auth", () => {
	it("throws when tenant context is missing", async () => {
		mockResolveTenant.mockResolvedValueOnce(null);
		await expect(
			mobileWikiSearch(
				{},
				{ agentId: "agent-1", query: "austin" },
				makeCtx({ tenantId: null }),
			),
		).rejects.toThrow(/Tenant context required/);
	});

	it("throws when agent is missing", async () => {
		mockAgentRow.mockReturnValueOnce([]);
		await expect(
			mobileWikiSearch(
				{},
				{ agentId: "agent-1", query: "austin" },
				makeCtx(),
			),
		).rejects.toThrow(/Agent not found/);
	});

	it("throws when agent belongs to a different tenant", async () => {
		mockAgentRow.mockReturnValueOnce([
			{ id: "agent-1", tenant_id: "t-other", slug: "marco" },
		]);
		await expect(
			mobileWikiSearch(
				{},
				{ agentId: "agent-1", query: "austin" },
				makeCtx(),
			),
		).rejects.toThrow(/Agent not found|access denied/);
	});

	it("falls back to resolveCallerTenantId when ctx.auth.tenantId is null", async () => {
		mockResolveTenant.mockResolvedValueOnce("t1");
		mockExecute.mockResolvedValueOnce({ rows: [] });
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin" },
			makeCtx({ tenantId: null }),
		);
		expect(mockResolveTenant).toHaveBeenCalled();
		expect(out).toEqual([]);
	});
});

describe("mobileWikiSearch — FTS path", () => {
	it("returns rows shaped as { page, score, matchingMemoryIds: [] } for happy path", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [makeRow()] });
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin" },
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
			ownerId: "agent-1",
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
			{ agentId: "agent-1", query: "austin" },
			makeCtx(),
		);
		expect(out.map((r) => r.page.id)).toEqual(["p-top", "p-mid", "p-low"]);
	});

	it("returns [] when FTS finds no matching pages", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "zzzznothing" },
			makeCtx(),
		);
		expect(out).toEqual([]);
	});

	it("handles null `rows` shape from the driver defensively", async () => {
		mockExecute.mockResolvedValueOnce({});
		const out = await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin" },
			makeCtx(),
		);
		expect(out).toEqual([]);
	});

	it("clamps limit above MAX_LIMIT (50) and below 1", async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin", limit: 9999 },
			makeCtx(),
		);
		await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin", limit: 0 },
			makeCtx(),
		);

		// Inspect the last sql-tagged-template argument block passed to db.execute.
		// sql`…${x}` is mocked to pass the interpolation args through verbatim,
		// so we can grep the flattened args for the clamped limit value.
		const allArgs = mockExecute.mock.calls.flatMap((call) => call.flat(3));
		expect(allArgs).toContain(50); // clamp of 9999
		expect(allArgs).toContain(1); // clamp of 0
	});

	it("interpolates the trimmed query into a plainto_tsquery call (not to_tsquery)", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "  Dake's Shoppe  " },
			makeCtx(),
		);
		// The sql tag is mocked to pass its template chunks + interpolations
		// through verbatim. Flatten and stringify the whole call so we can
		// assert both that the trimmed query is bound AND that the query
		// uses plainto_tsquery — swapping to to_tsquery would crash on raw
		// user apostrophes ("Dake's"), so this guard has real teeth.
		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("Dake's Shoppe");
		expect(flattened).not.toContain("  Dake's Shoppe  ");
		expect(flattened).toContain("plainto_tsquery");
		expect(flattened).not.toContain("to_tsquery('english', $");
	});

	it("never invokes Hindsight recall", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [makeRow()] });
		const recall = vi.fn();
		mockGetMemoryServices.mockReturnValue({ recall: { recall } });
		await mobileWikiSearch(
			{},
			{ agentId: "agent-1", query: "austin" },
			makeCtx(),
		);
		expect(mockGetMemoryServices).not.toHaveBeenCalled();
		expect(recall).not.toHaveBeenCalled();
	});
});
