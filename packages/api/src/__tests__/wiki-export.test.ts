/**
 * wiki-export — tenant-scope bundle key shape (plan 2026-06-09-004 U14).
 *
 * Null-owner (tenant) scopes must export under the reserved
 * `<tenant_slug>/_tenant/<date>/vault.md.gz` key — never under another
 * owner's prefix — and the per-scope page query must use IS NULL (drizzle's
 * eq(col, null) emits `= NULL`, which silently exports zero pages).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectResults, selectDistinctResults, mockS3Send, mockIsNull } =
  vi.hoisted(() => ({
    selectResults: [] as unknown[][],
    selectDistinctResults: [] as unknown[][],
    mockS3Send: vi.fn(),
    mockIsNull: vi.fn((col: unknown) => ({ __isNull: col })),
  }));

vi.mock("../lib/db.js", () => {
  const chainFor = (queue: unknown[][]) => {
    const rows = queue.shift() ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (resolve: (v: unknown[]) => unknown, reject?: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => chainFor(selectResults)),
      selectDistinct: vi.fn(() => chainFor(selectDistinctResults)),
    },
  };
});

vi.mock("@thinkwork/database-pg/schema", () => {
  const col = (name: string) => ({ name });
  return {
    wikiPages: {
      tenant_id: col("pages.tenant_id"),
      owner_id: col("pages.owner_id"),
      type: col("pages.type"),
      slug: col("pages.slug"),
      status: col("pages.status"),
    },
    tenants: { id: col("tenants.id"), slug: col("tenants.slug") },
    agents: { id: col("agents.id"), slug: col("agents.slug") },
    wikiPageSections: {
      page_id: col("sections.page_id"),
      position: col("sections.position"),
    },
    wikiPageAliases: {
      page_id: col("aliases.page_id"),
      alias: col("aliases.alias"),
    },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("drizzle-orm");
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...xs: unknown[]) => ({ __and: xs }),
    asc: (x: unknown) => ({ __asc: x }),
    inArray: (a: unknown, b: unknown) => ({ __in: [a, b] }),
    isNull: mockIsNull,
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommandMock {
    public readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
    PutObjectCommand: PutObjectCommandMock,
  };
});

import { handler } from "../handlers/wiki-export.js";

const TODAY = new Date().toISOString().slice(0, 10);

function pageRow(over: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    tenant_id: "t1",
    owner_id: null,
    type: "entity",
    slug: "acme",
    title: "Acme",
    summary: "Customer",
    status: "active",
    last_compiled_at: new Date("2026-06-09T00:00:00Z"),
    ...over,
  };
}

function sentKeys(): string[] {
  return mockS3Send.mock.calls.map(
    (c) => (c[0] as { input: { Key: string } }).input.Key,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  selectDistinctResults.length = 0;
  mockS3Send.mockResolvedValue({});
  process.env.WIKI_EXPORT_BUCKET = "wiki-exports-test";
  delete process.env.BRAIN_ARTIFACTS_BUCKET;
});

describe("wiki-export tenant scope", () => {
  it("writes the null-owner bundle under <tenant_slug>/_tenant/<date>/", async () => {
    selectDistinctResults.push([{ tenant_id: "t1", owner_id: null }]);
    selectResults.push(
      // tenants lookup (agents lookup is skipped: no non-null owners)
      [{ id: "t1", slug: "acme-co" }],
      // pages for the (t1, NULL) scope
      [pageRow()],
      // sections + aliases for page-1
      [
        {
          heading: "Overview",
          body_md: "Acme overview.",
          position: 0,
        },
      ],
      [{ alias: "Acme Corp" }],
    );

    const result = await handler({});

    expect(result.ok).toBe(true);
    expect(result.bundles_written).toBe(1);
    expect(result.pages_exported).toBe(1);
    expect(sentKeys()).toEqual([`acme-co/_tenant/${TODAY}/vault.md.gz`]);
    // The scope page query went through IS NULL — not eq(owner_id, null).
    expect(mockIsNull).toHaveBeenCalled();
  });

  it("keeps owner bundles on their own prefix alongside the tenant bundle", async () => {
    selectDistinctResults.push([
      { tenant_id: "t1", owner_id: null },
      { tenant_id: "t1", owner_id: "agent-1" },
    ]);
    selectResults.push(
      // tenants, then agents lookups
      [{ id: "t1", slug: "acme-co" }],
      [{ id: "agent-1", slug: "eric-agent" }],
      // scope 1 (tenant): one page + its sections + aliases
      [pageRow()],
      [{ heading: "Overview", body_md: "Tenant page.", position: 0 }],
      [],
      // scope 2 (agent-1): one page + its sections + aliases
      [pageRow({ id: "page-2", owner_id: "agent-1", slug: "private" })],
      [{ heading: "Notes", body_md: "User page.", position: 0 }],
      [],
    );

    const result = await handler({});

    expect(result.bundles_written).toBe(2);
    const keys = sentKeys();
    expect(keys).toContain(`acme-co/_tenant/${TODAY}/vault.md.gz`);
    expect(keys).toContain(`acme-co/eric-agent/${TODAY}/vault.md.gz`);
    // The tenant bundle never lands under an owner prefix.
    expect(keys.filter((k) => k.includes("/_tenant/"))).toHaveLength(1);
  });
});
