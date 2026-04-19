/**
 * Unit tests for the wikiGraph resolver.
 *
 * The resolver runs two raw `db.execute(sql`...`)` calls — first for
 * pages+degree, second for edges. We mock `db.execute` to return scripted
 * row batches in order, plus stub `assertCanReadWikiScope` so we can
 * exercise output shaping without a live Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute, mockAssertReadScope } = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockAssertReadScope: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => ({
	db: { execute: mockExecute },
	eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
	and: (...xs: unknown[]) => ({ __and: xs }),
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("../graphql/resolvers/wiki/auth.js", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import(
		"../graphql/resolvers/wiki/auth.js"
	);
	return {
		...actual,
		assertCanReadWikiScope: mockAssertReadScope,
	};
});

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		sql: (...xs: unknown[]) => xs,
	};
});

import { wikiGraph } from "../graphql/resolvers/wiki/wikiGraph.query.js";
import { WikiAuthError } from "../graphql/resolvers/wiki/auth.js";
import type { GraphQLContext } from "../graphql/context.js";

function makeCtx(): GraphQLContext {
	return {
		auth: {
			principalId: "user-1",
			tenantId: "t1",
			email: "eric@example.com",
			authType: "cognito",
		},
	} as unknown as GraphQLContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAssertReadScope.mockResolvedValue(undefined);
});

describe("wikiGraph", () => {
	it("returns nodes and edges with memoryGraph-compatible wire shape", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [
					{
						id: "p1",
						type: "entity",
						slug: "mom",
						title: "Mom",
						edge_count: 2,
					},
					{
						id: "p2",
						type: "topic",
						slug: "meals",
						title: "Mom's meals",
						edge_count: 1,
					},
					{
						id: "p3",
						type: "decision",
						slug: "home-care",
						title: "Home care vs SNF",
						edge_count: 1,
					},
				],
			})
			.mockResolvedValueOnce({
				rows: [
					{ source: "p1", target: "p2" },
					{ source: "p3", target: "p1" },
				],
			});

		const graph = await wikiGraph(
			null,
			{ tenantId: "t1", ownerId: "a1" },
			makeCtx(),
		);

		expect(graph.nodes).toEqual([
			{
				id: "p1",
				label: "Mom",
				type: "page",
				entityType: "ENTITY",
				slug: "mom",
				strategy: null,
				edgeCount: 2,
				latestThreadId: null,
			},
			{
				id: "p2",
				label: "Mom's meals",
				type: "page",
				entityType: "TOPIC",
				slug: "meals",
				strategy: null,
				edgeCount: 1,
				latestThreadId: null,
			},
			{
				id: "p3",
				label: "Home care vs SNF",
				type: "page",
				entityType: "DECISION",
				slug: "home-care",
				strategy: null,
				edgeCount: 1,
				latestThreadId: null,
			},
		]);
		expect(graph.edges).toEqual([
			{ source: "p1", target: "p2", label: "references", weight: 0.5 },
			{ source: "p3", target: "p1", label: "references", weight: 0.5 },
		]);
	});

	it("returns empty graph when scope has no pages", async () => {
		mockExecute
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [] });

		const graph = await wikiGraph(
			null,
			{ tenantId: "t1", ownerId: "a-empty" },
			makeCtx(),
		);

		expect(graph).toEqual({ nodes: [], edges: [] });
	});

	it("handles pages with zero links (isolated nodes) without crashing", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [
					{
						id: "p-solo",
						type: "topic",
						slug: "solo",
						title: "Solo page",
						edge_count: 0,
					},
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const graph = await wikiGraph(
			null,
			{ tenantId: "t1", ownerId: "a1" },
			makeCtx(),
		);

		expect(graph.nodes).toHaveLength(1);
		expect(graph.nodes[0].edgeCount).toBe(0);
		expect(graph.edges).toEqual([]);
	});

	it("coerces nullish edge_count to 0", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [
					{
						id: "p1",
						type: "entity",
						slug: "x",
						title: "X",
						edge_count: null as unknown as number,
					},
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const graph = await wikiGraph(
			null,
			{ tenantId: "t1", ownerId: "a1" },
			makeCtx(),
		);

		expect(graph.nodes[0].edgeCount).toBe(0);
	});

	it("propagates WikiAuthError from assertCanReadWikiScope", async () => {
		mockAssertReadScope.mockRejectedValueOnce(
			new WikiAuthError("Access denied: tenant mismatch"),
		);

		await expect(
			wikiGraph(
				null,
				{ tenantId: "t-other", ownerId: "a1" },
				makeCtx(),
			),
		).rejects.toThrow(WikiAuthError);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
