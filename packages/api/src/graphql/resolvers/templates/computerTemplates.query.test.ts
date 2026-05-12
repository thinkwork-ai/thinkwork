import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, lastWhereRef } = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	lastWhereRef: { value: null as unknown },
}));

vi.mock("../../utils.js", () => ({
	db: { select: mockSelect },
	agentTemplates: {
		template_kind: "agent_templates.template_kind",
		tenant_id: "agent_templates.tenant_id",
	},
	and: vi.fn((...parts: unknown[]) => ({ kind: "and", parts })),
	or: vi.fn((...parts: unknown[]) => ({ kind: "or", parts })),
	eq: vi.fn((left: unknown, right: unknown) => ({
		kind: "eq",
		left,
		right,
	})),
	isNull: vi.fn((col: unknown) => ({ kind: "isNull", col })),
	templateToCamel: (row: Record<string, unknown>) => ({
		id: row.id,
		tenantId: row.tenant_id ?? null,
		templateKind: row.template_kind,
		slug: row.slug,
		runtime: row.runtime ?? "agentcore",
	}),
}));

vi.mock("../agents/runtime.js", () => ({
	withGraphqlAgentRuntime: (row: Record<string, unknown>) => row,
}));

let resolver: typeof import("./computerTemplates.query.js");

beforeEach(async () => {
	vi.resetModules();
	mockSelect.mockReset();
	lastWhereRef.value = null;

	mockSelect.mockReturnValue({
		from: () => ({
			where: (w: unknown) => {
				lastWhereRef.value = w;
				return Promise.resolve([
					{
						id: "tpl-platform",
						tenant_id: null,
						slug: "thinkwork-computer-default",
						template_kind: "computer",
					},
					{
						id: "tpl-tenant",
						tenant_id: "tenant-1",
						slug: "custom-computer",
						template_kind: "computer",
					},
				]);
			},
		}),
	});

	resolver = await import("./computerTemplates.query.js");
});

describe("computerTemplates", () => {
	it("returns the union of tenant-scoped + NULL-tenant computer templates", async () => {
		const result = await resolver.computerTemplates_query(
			null,
			{ tenantId: "tenant-1" },
			{} as any,
		);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			id: "tpl-platform",
			tenantId: null,
			slug: "thinkwork-computer-default",
		});
		expect(result[1]).toMatchObject({
			id: "tpl-tenant",
			tenantId: "tenant-1",
		});
	});

	it("filters by template_kind='computer' and tenant union in the WHERE clause", async () => {
		await resolver.computerTemplates_query(
			null,
			{ tenantId: "tenant-1" },
			{} as any,
		);

		const where = lastWhereRef.value as {
			kind: string;
			parts: Array<{ kind: string; right?: unknown; parts?: unknown[] }>;
		};
		expect(where.kind).toBe("and");
		// First arg pins template_kind = 'computer'
		expect(where.parts[0]).toMatchObject({
			kind: "eq",
			right: "computer",
		});
		// Second arg unions tenant_id = $tenantId OR IS NULL
		const tenantUnion = where.parts[1];
		expect(tenantUnion.kind).toBe("or");
		expect(tenantUnion.parts).toHaveLength(2);
	});

	it("returns an empty array when no computer templates exist for the tenant", async () => {
		mockSelect.mockReturnValueOnce({
			from: () => ({
				where: () => Promise.resolve([]),
			}),
		});

		const result = await resolver.computerTemplates_query(
			null,
			{ tenantId: "tenant-empty" },
			{} as any,
		);

		expect(result).toEqual([]);
	});
});
