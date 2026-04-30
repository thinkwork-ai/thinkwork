import { describe, expect, it } from "vitest";
import { createWikiSourceAgentTools } from "./wiki-source-agent-tools.js";
import type { UserWikiSearchResult } from "../../wiki/search.js";

describe("wiki source agent tools", () => {
	it("searches, remembers pages, and allows reading observed pages", async () => {
		const row = wikiRow("page-auberge-bressane", "Auberge Bressane");
		const toolSet = createWikiSourceAgentTools({
			tenantId: "tenant-1",
			userId: "user-1",
			defaultLimit: 5,
			search: async (args) => {
				expect(args).toEqual({
					tenantId: "tenant-1",
					userId: "user-1",
					query: "favorite restaurant in Paris",
					limit: 2,
				});
				return [row];
			},
		});
		const remembered = new Map<string, unknown>();
		const observedSourceIds = new Set<string>();
		const context = {
			query: "favorite restaurant",
			turn: 1,
			observedSourceIds,
			rememberSource(id: string, value: unknown) {
				observedSourceIds.add(id);
				remembered.set(id, value);
			},
			getSource<T = unknown>(id: string): T | undefined {
				return remembered.get(id) as T | undefined;
			},
		};

		const search = await toolSet.tools[0]!.execute(
			{ query: "favorite restaurant in Paris", limit: 2 },
			context,
		);
		expect(search.citedSourceIds).toEqual(["page-auberge-bressane"]);
		expect(observedSourceIds.has("page-auberge-bressane")).toBe(true);
		expect(toolSet.getPage("page-auberge-bressane")).toEqual(row);

		const read = await toolSet.tools[1]!.execute(
			{ page_id: "page-auberge-bressane" },
			context,
		);
		expect(read.summary).toBe('read compiled page "Auberge Bressane"');
		expect(read.observation).toMatchObject({
			id: "page-auberge-bressane",
			title: "Auberge Bressane",
			body_md: "Auberge Bressane is a favorite restaurant in Paris.",
		});
	});

	it("refuses to read pages the agent has not observed", async () => {
		const toolSet = createWikiSourceAgentTools({
			tenantId: "tenant-1",
			userId: "user-1",
			defaultLimit: 5,
			search: async () => [],
		});

		await expect(
			toolSet.tools[1]!.execute(
				{ page_id: "page-secret" },
				{
					query: "secret",
					turn: 1,
					observedSourceIds: new Set(),
					rememberSource() {},
					getSource() {
						return undefined;
					},
				},
			),
		).rejects.toThrow("page page-secret has not been observed by search");
	});
});

function wikiRow(id: string, title: string): UserWikiSearchResult {
	return {
		score: 0.9,
		matchedAlias: null,
		page: {
			id,
			tenantId: "tenant-1",
			userId: "user-1",
			ownerId: "user-1",
			type: "ENTITY",
			slug: title.toLowerCase().replaceAll(" ", "-"),
			title,
			summary: "Paris restaurant known for souffle.",
			bodyMd: `${title} is a favorite restaurant in Paris.`,
			status: "ACTIVE",
			aliases: [],
			sections: [],
			lastCompiledAt: null,
			createdAt: "2026-04-30T00:00:00.000Z",
			updatedAt: "2026-04-30T00:00:00.000Z",
		},
	};
}
