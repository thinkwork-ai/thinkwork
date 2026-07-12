import { describe, expect, it } from "vitest";

import type { TwentyRestClient } from "../../twenty/rest-client.js";
import {
  acquireCompaniesPage,
  buildCompanyDossier,
  hindsightDocumentIdFor,
  normalizeCompany,
  projectionKeyForCompany,
  type TwentyCompaniesCursor,
} from "./twenty.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";

function company(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "c1",
    name: "Acme",
    domainName: "acme.com",
    employees: 42,
    annualRecurringRevenue: {
      amountMicros: 1_250_000_000_000,
      currencyCode: "USD",
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeCompany
// ---------------------------------------------------------------------------

describe("normalizeCompany", () => {
  it("handles domainName as a string and as {primaryLinkUrl}", () => {
    const a = normalizeCompany({
      id: "c1",
      name: "Acme",
      domainName: "acme.com",
    });
    const b = normalizeCompany({
      id: "c1",
      name: "Acme",
      domainName: { primaryLinkUrl: "https://acme.com" },
    });
    expect(a.domainName).toBe("acme.com");
    expect(b.domainName).toBe("https://acme.com");
  });

  it("keeps the annualRecurringRevenue composite shape", () => {
    const snapshot = normalizeCompany(company());
    expect(snapshot.annualRecurringRevenue).toEqual({
      amountMicros: 1_250_000_000_000,
      currencyCode: "USD",
    });
  });

  it("drops null and undefined keys", () => {
    const snapshot = normalizeCompany({
      id: "c1",
      name: "Acme",
      employees: null,
      domainName: undefined,
    });
    expect(snapshot).not.toHaveProperty("employees");
    expect(snapshot).not.toHaveProperty("domainName");
  });

  it("unwraps array-shaped relations and keeps only allow-listed fields", () => {
    const snapshot = normalizeCompany(
      company({
        people: [
          {
            id: "p1",
            name: { firstName: "Ada", lastName: "Lovelace" },
            jobTitle: "CTO",
            emails: { primaryEmail: "ada@acme.com" },
            apiToken: "tw_secret_abc",
            password: "hunter2",
          },
        ],
      }),
    );
    expect(snapshot.people).toEqual([
      {
        id: "p1",
        name: "Ada Lovelace",
        jobTitle: "CTO",
        email: "ada@acme.com",
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("tw_secret_abc");
    expect(JSON.stringify(snapshot)).not.toContain("hunter2");
  });

  it("unwraps connection-shaped ({edges:[{node}]}) relations", () => {
    const snapshot = normalizeCompany(
      company({
        opportunities: {
          edges: [
            {
              node: {
                id: "o1",
                name: "Big deal",
                stage: "PROPOSAL",
                amount: { amountMicros: 5_000_000_000, currencyCode: "USD" },
              },
            },
          ],
        },
      }),
    );
    expect(snapshot.opportunities).toEqual([
      {
        id: "o1",
        name: "Big deal",
        stage: "PROPOSAL",
        amount: { amountMicros: 5_000_000_000, currencyCode: "USD" },
      },
    ]);
  });

  it("bounds each relation at 20 items and marks truncated", () => {
    const people = Array.from({ length: 30 }, (_, i) => ({
      id: `p${String(i).padStart(2, "0")}`,
      name: `Person ${i}`,
    }));
    const snapshot = normalizeCompany(company({ people }));
    expect((snapshot.people as unknown[]).length).toBe(20);
    expect(snapshot.truncated).toBe(true);
  });

  it("truncates note bodies to 2000 chars and prefers bodyV2 markdown", () => {
    const snapshot = normalizeCompany(
      company({
        notes: [
          { id: "n1", title: "Long", bodyV2: { markdown: "x".repeat(5000) } },
        ],
      }),
    );
    const note = (snapshot.notes as Record<string, unknown>[])[0]!;
    expect((note.body as string).length).toBe(2000);
  });

  it("caps the serialized snapshot near 64KB by dropping relation tails", () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${String(i).padStart(2, "0")}`,
      title: `Note ${i}`,
      body: "y".repeat(2000),
    }));
    const people = Array.from({ length: 20 }, (_, i) => ({
      id: `p${String(i).padStart(2, "0")}`,
      name: "z".repeat(1500),
    }));
    const opportunities = Array.from({ length: 20 }, (_, i) => ({
      id: `o${String(i).padStart(2, "0")}`,
      name: "w".repeat(1500),
    }));
    const snapshot = normalizeCompany(
      company({ notes, people, opportunities }),
    );
    expect(
      Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
    ).toBeLessThanOrEqual(64 * 1024);
    expect(snapshot.truncated).toBe(true);
  });

  it("omits the truncated marker when nothing was cut", () => {
    expect(normalizeCompany(company())).not.toHaveProperty("truncated");
  });
});

// ---------------------------------------------------------------------------
// buildCompanyDossier
// ---------------------------------------------------------------------------

describe("buildCompanyDossier", () => {
  it("is deterministic — identical snapshots produce identical markdown", () => {
    const snapshot = normalizeCompany(
      company({
        people: [
          { id: "p2", name: "Bob" },
          { id: "p1", name: "Ada" },
        ],
        notes: [{ id: "n1", title: "Kickoff", body: "Met the team." }],
      }),
    );
    const one = buildCompanyDossier(snapshot);
    const two = buildCompanyDossier(snapshot);
    expect(one.markdown).toBe(two.markdown);
    expect(one.title).toBe("Acme");
    expect(one.markdown.startsWith("# Acme")).toBe(true);
  });

  it("formats ARR from amountMicros in the overview", () => {
    const { markdown } = buildCompanyDossier(normalizeCompany(company()));
    expect(markdown).toContain("Annual recurring revenue: 1,250,000 USD");
    expect(markdown).toContain("- Domain: acme.com");
    expect(markdown).toContain("- Employees: 42");
  });

  it("skips empty sections", () => {
    const { markdown } = buildCompanyDossier(normalizeCompany(company()));
    expect(markdown).not.toContain("## People");
    expect(markdown).not.toContain("## Opportunities");
    expect(markdown).not.toContain("## Notes");
  });

  it("renders people/opportunities/notes sections with id-stable ordering", () => {
    const snapshot = normalizeCompany(
      company({
        people: [
          { id: "p2", name: "Bob", jobTitle: "CEO", email: "bob@acme.com" },
          { id: "p1", name: "Ada", jobTitle: "CTO" },
        ],
        opportunities: [
          {
            id: "o1",
            name: "Renewal",
            stage: "WON",
            amount: { amountMicros: 5_000_000_000, currencyCode: "USD" },
            closeDate: "2026-09-01",
          },
        ],
        notes: [
          { id: "n1", title: "Kickoff", body: "Met the team.\nGood vibes." },
        ],
      }),
    );
    const { markdown } = buildCompanyDossier(snapshot);
    expect(markdown.indexOf("- Ada — CTO")).toBeLessThan(
      markdown.indexOf("- Bob — CEO — bob@acme.com"),
    );
    expect(markdown).toContain(
      "- Renewal — WON — 5,000 USD — closes 2026-09-01",
    );
    expect(markdown).toContain("**Kickoff**");
    expect(markdown).toContain("Met the team. Good vibes.");
  });

  it("stays under ~16KB with an explicit truncation marker", () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${String(i).padStart(2, "0")}`,
      title: `Note ${i}`,
      body: "y".repeat(2000),
    }));
    const { markdown } = buildCompanyDossier(
      normalizeCompany(company({ notes })),
    );
    expect(markdown.length).toBeLessThanOrEqual(16 * 1024 + 100);
    expect(markdown).toContain("…truncated");
  });
});

// ---------------------------------------------------------------------------
// Projection identity helpers
// ---------------------------------------------------------------------------

describe("projection/document id helpers", () => {
  it("builds stable keys", () => {
    expect(projectionKeyForCompany("c1")).toBe("company:c1");
    expect(hindsightDocumentIdFor("src1", "company:c1")).toBe(
      "external:src1:company:c1",
    );
  });
});

// ---------------------------------------------------------------------------
// acquireCompaniesPage
// ---------------------------------------------------------------------------

type ListPageArgs = Parameters<TwentyRestClient["listPage"]>;

function stubClient(records: Record<string, unknown>[]) {
  const calls: ListPageArgs[] = [];
  const client = {
    listPage: async (...args: ListPageArgs) => {
      calls.push(args);
      return { records, pageInfo: undefined, payload: null };
    },
  } as unknown as TwentyRestClient;
  return { client, calls };
}

describe("acquireCompaniesPage", () => {
  const cursor: TwentyCompaniesCursor = {
    lastUpdatedAt: "2026-01-01T00:00:00Z",
    lastId: "b",
  };

  it("passes limit/depth/orderBy/filter to listPage", async () => {
    const { client, calls } = stubClient([]);
    await acquireCompaniesPage(client, {
      cursor,
      pageSize: 25,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(calls[0]![0]).toBe("companies");
    expect(calls[0]![1]).toEqual({
      limit: 25,
      depth: 1,
      orderBy: "updatedAt[AscNullsFirst]",
      filter: "updatedAt[gte]:2026-01-01T00:00:00Z",
    });
  });

  it("omits the filter when there is no cursor", async () => {
    const { client, calls } = stubClient([]);
    await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 25,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect((calls[0]![1] as { filter?: string }).filter).toBeUndefined();
  });

  it("drops records covered by the cursor (older, or equal-time id <= lastId)", async () => {
    const { client } = stubClient([
      { id: "z", updatedAt: "2025-12-31T00:00:00Z" }, // older → dropped
      { id: "a", updatedAt: "2026-01-01T00:00:00Z" }, // equal, id <= b → dropped
      { id: "b", updatedAt: "2026-01-01T00:00:00Z" }, // equal, id == b → dropped
      { id: "c", updatedAt: "2026-01-01T00:00:00Z" }, // equal, id > b → kept
      { id: "d", updatedAt: "2026-02-01T00:00:00Z" }, // newer → kept
    ]);
    const page = await acquireCompaniesPage(client, {
      cursor,
      pageSize: 5,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(page.rawCount).toBe(5);
    expect(page.items.map((item) => item.sourceItemId)).toEqual(["c", "d"]);
  });

  it("sorts client-side even when the server returns records out of order", async () => {
    const { client } = stubClient([
      { id: "d", updatedAt: "2026-02-01T00:00:00Z" },
      { id: "c", updatedAt: "2026-01-15T00:00:00Z" },
    ]);
    const page = await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 2,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(page.items.map((item) => item.sourceItemId)).toEqual(["c", "d"]);
    expect(page.nextCursor).toEqual({
      lastUpdatedAt: "2026-02-01T00:00:00Z",
      lastId: "d",
    });
  });

  it("returns a null nextCursor on a short page", async () => {
    const { client } = stubClient([
      { id: "a", updatedAt: "2026-01-01T00:00:00Z" },
    ]);
    const page = await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 10,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(page.nextCursor).toBeNull();
  });

  it("keeps a resume cursor when boundary.maxRecords trims a short page", async () => {
    const { client } = stubClient([
      { id: "a", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", updatedAt: "2026-01-02T00:00:00Z" },
      { id: "c", updatedAt: "2026-01-03T00:00:00Z" },
    ]);
    const page = await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 10,
      boundary: { maxRecords: 2 },
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(page.items.map((item) => item.sourceItemId)).toEqual(["a", "b"]);
    expect(page.nextCursor).toEqual({
      lastUpdatedAt: "2026-01-02T00:00:00Z",
      lastId: "b",
    });
  });

  it("maps EvidenceUpsert fields with a stable contentHash", async () => {
    const record = company({ id: "c9", updatedAt: "2026-06-01T00:00:00Z" });
    const { client } = stubClient([record]);
    const args = {
      cursor: null,
      pageSize: 10,
      targetScope: "tenant" as const,
      targetId: TENANT_ID,
    };
    const first = await acquireCompaniesPage(client, args);
    const { client: again } = stubClient([{ ...record }]);
    const second = await acquireCompaniesPage(again, args);

    const item = first.items[0]!;
    expect(item.sourceItemId).toBe("c9");
    expect(item.sourceVersion).toBe("2026-06-01T00:00:00Z");
    expect(item.sourceTimestamp).toEqual(new Date("2026-06-01T00:00:00Z"));
    expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(item.contentHash).toBe(second.items[0]!.contentHash);
    expect(item.targetScope).toBe("tenant");
    expect(item.targetId).toBe(TENANT_ID);
    expect(item.extractionRecipe).toEqual({
      source: "twenty",
      kind: "company_dossier",
      recipeVersion: "u1.1",
      depth: 1,
    });
    expect(item.normalizedSnapshot).toEqual(normalizeCompany(record));
  });

  it("falls back to a content-hash-prefix sourceVersion when updatedAt is missing", async () => {
    const { client } = stubClient([{ id: "c1", name: "Acme" }]);
    const page = await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 10,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    const item = page.items[0]!;
    expect(item.sourceVersion).toBe(item.contentHash.slice(0, 16));
    expect(item.sourceTimestamp).toBeNull();
  });

  it("honors a custom recipeVersion", async () => {
    const { client } = stubClient([
      { id: "c1", updatedAt: "2026-01-01T00:00:00Z" },
    ]);
    const page = await acquireCompaniesPage(client, {
      cursor: null,
      pageSize: 10,
      targetScope: "space",
      targetId: "space-1",
      recipeVersion: "u1.2",
    });
    expect(page.items[0]!.extractionRecipe.recipeVersion).toBe("u1.2");
    expect(page.items[0]!.targetScope).toBe("space");
  });
});
