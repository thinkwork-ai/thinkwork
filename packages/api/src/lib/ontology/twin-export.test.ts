import { describe, expect, it, vi } from "vitest";
import {
  compileTwinMappingExport,
  regenerateTwinMappingExport,
  TWIN_MAPPING_FORMAT,
} from "./twin-export.js";

/**
 * Fake drizzle db for the compiler's three reads, in call order:
 * active version → entity rows → relationship rows.
 */
class FakeExportDb {
  constructor(private queues: unknown[][]) {}

  select() {
    const rows = this.queues.shift() ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }
}

const entityRow = (overrides: Record<string, unknown> = {}) => ({
  slug: "customer",
  name: "Customer",
  lifecycle_status: "approved",
  twin_facets: [
    {
      slug: "aging",
      clonePolicy: "deep_clone",
      sourceSystem: "lastmile",
      attributes: [
        {
          sourceField: "days_past_due",
          attribute: "daysPastDue",
          filterType: "number",
        },
      ],
    },
  ],
  twin_facets_version: 2,
  page_sections: [
    {
      slug: "aging",
      heading: "Aging",
      kind: "facet_backed",
      facetSlug: "aging",
      visibility: "all_members",
      position: 0,
    },
  ],
  page_sections_version: 1,
  ...overrides,
});

const relationshipRow = (overrides: Record<string, unknown> = {}) => ({
  slug: "customer_has_ship_to",
  name: "has ship-to",
  lifecycle_status: "approved",
  source_type_slugs: ["customer"],
  target_type_slugs: ["ship_to"],
  source_binding: {
    sourceSystem: "lastmile",
    sourceDataset: "ship_tos",
    sourceKeyFields: ["customer_id"],
    targetKeyFields: ["ship_to_id"],
  },
  source_binding_version: 3,
  ...overrides,
});

describe("compileTwinMappingExport", () => {
  it("compiles declarations into the versioned export shape", async () => {
    const db = new FakeExportDb([
      [{ version_number: 4 }],
      [entityRow()],
      [relationshipRow()],
    ]);

    const doc = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: db as any,
      now: new Date("2026-07-21T00:00:00Z"),
    });

    expect(doc.format).toBe(TWIN_MAPPING_FORMAT);
    expect(doc.tenantId).toBe("tenant-1");
    expect(doc.ontologyVersion).toBe(4);
    // sequence = ontologyVersion + twin_facets_version + page_sections_version
    //          + source_binding_version = 4 + 2 + 1 + 3
    expect(doc.sequence).toBe(10);
    expect(doc.entities).toHaveLength(1);
    expect(doc.entities[0].facets[0]).toMatchObject({
      slug: "aging",
      clonePolicy: "deep_clone",
      sourceSystem: "lastmile",
    });
    expect(doc.entities[0].pageSections[0]).toMatchObject({ slug: "aging" });
    expect(doc.relationships[0].binding).toMatchObject({
      sourceDataset: "ship_tos",
    });
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic: identical declarations produce an identical contentHash", async () => {
    const build = () =>
      new FakeExportDb([
        [{ version_number: 4 }],
        [entityRow()],
        [relationshipRow()],
      ]);
    const a = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: build() as any,
      now: new Date("2026-07-21T00:00:00Z"),
    });
    const b = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: build() as any,
      now: new Date("2026-07-22T09:30:00Z"),
    });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.sequence).toBe(b.sequence);
  });

  it("a limit flip bumps the sequence and changes the hash (F3 / AE3 setup)", async () => {
    const before = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: new FakeExportDb([
        [{ version_number: 4 }],
        [entityRow()],
        [relationshipRow()],
      ]) as any,
    });
    const after = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: new FakeExportDb([
        [{ version_number: 4 }],
        [
          entityRow({
            twin_facets: [
              {
                slug: "aging",
                clonePolicy: "limited",
                sourceSystem: "lastmile",
              },
            ],
            twin_facets_version: 3,
          }),
        ],
        [relationshipRow()],
      ]) as any,
    });
    expect(after.sequence).toBeGreaterThan(before.sequence);
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.entities[0].facets[0].clonePolicy).toBe("limited");
  });

  it("excludes unapproved types and unbound relationships; counts their versions in the sequence", async () => {
    const doc = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: new FakeExportDb([
        [],
        [
          entityRow({ lifecycle_status: "proposed" }),
          entityRow({
            slug: "tank",
            name: "Tank",
            twin_facets_version: 0,
            page_sections_version: 0,
            twin_facets: [],
            page_sections: [],
          }),
        ],
        [relationshipRow({ source_binding: {}, source_binding_version: 1 })],
      ]) as any,
    });
    // proposed type excluded; declaration-less approved type excluded;
    // unbound relationship excluded — but versions still count so the
    // sequence stays monotone across approval flips.
    expect(doc.entities).toHaveLength(0);
    expect(doc.relationships).toHaveLength(0);
    expect(doc.ontologyVersion).toBe(0);
    expect(doc.sequence).toBe(4); // 0 + (2+1) + (0+0) + 1
  });
});

describe("regenerateTwinMappingExport", () => {
  const declaredDb = () =>
    new FakeExportDb([
      [{ version_number: 4 }],
      [entityRow()],
      [relationshipRow()],
    ]);

  it("uploads by-sequence and latest objects with metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const result = await regenerateTwinMappingExport({
      tenantId: "tenant-1",
      db: declaredDb() as any,
      s3: { send } as any,
      bucket: "brain-artifacts",
    });

    expect(result.state).toBe("uploaded");
    expect(result.sequence).toBe(10);
    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map((call) => call[0].input.Key);
    expect(keys).toEqual([
      "twin-mapping/tenant-1/by-sequence/10.json",
      "twin-mapping/tenant-1/latest.json",
    ]);
    const body = JSON.parse(send.mock.calls[1][0].input.Body as string);
    expect(body.format).toBe(TWIN_MAPPING_FORMAT);
    expect(send.mock.calls[1][0].input.Metadata.twin_export_sequence).toBe(
      "10",
    );
  });

  it("skips tenants with no twin declarations", async () => {
    const send = vi.fn();
    const result = await regenerateTwinMappingExport({
      tenantId: "tenant-1",
      db: new FakeExportDb([[], [], []]) as any,
      s3: { send } as any,
      bucket: "brain-artifacts",
    });
    expect(result.state).toBe("skipped_empty");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when no bucket is configured", async () => {
    const previous = process.env.BRAIN_ARTIFACTS_BUCKET;
    delete process.env.BRAIN_ARTIFACTS_BUCKET;
    try {
      const result = await regenerateTwinMappingExport({
        tenantId: "tenant-1",
        db: declaredDb() as any,
        s3: { send: vi.fn() } as any,
      });
      expect(result.state).toBe("skipped_no_bucket");
    } finally {
      if (previous !== undefined) {
        process.env.BRAIN_ARTIFACTS_BUCKET = previous;
      }
    }
  });

  it("never throws: an S3 failure comes back as an error result", async () => {
    const send = vi.fn().mockRejectedValue(new Error("s3 down"));
    const result = await regenerateTwinMappingExport({
      tenantId: "tenant-1",
      db: declaredDb() as any,
      s3: { send } as any,
      bucket: "brain-artifacts",
    });
    expect(result.state).toBe("error");
    expect(result.error).toContain("s3 down");
  });
});
