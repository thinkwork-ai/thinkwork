import { describe, expect, it } from "vitest";
import {
  BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS,
  ensureBaselineOntology,
} from "./baseline.js";

class FakeBaselineDb {
  inserts: Record<string, unknown>[] = [];

  constructor(
    private selectRows: unknown[][],
    private insertRows: unknown[][] = [],
  ) {}

  select() {
    const rows = this.selectRows.shift() ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  }

  insert() {
    return {
      values: (values: Record<string, unknown>) => {
        this.inserts.push(values);
        const rows = this.insertRows.shift() ?? [];
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(rows),
          }),
        };
      },
    };
  }
}

describe("ensureBaselineOntology", () => {
  it("seeds an active version with approved baseline entity types for a fresh tenant", async () => {
    const db = new FakeBaselineDb(
      // no active version, no prior versions
      [[], []],
      [
        [{ id: "version-1" }],
        [{ id: "et-1" }],
        [{ id: "et-2" }],
        [{ id: "et-3" }],
        [{ id: "et-4" }],
      ],
    );

    const result = await ensureBaselineOntology(db as any, "tenant-1");

    expect(result).toEqual({
      seeded: true,
      versionId: "version-1",
      entityTypeSlugs: ["customer", "person", "project", "task"],
    });
    expect(db.inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      version_number: 1,
      status: "active",
    });
    const entityInserts = db.inserts.slice(1);
    expect(entityInserts.map((row) => row.slug)).toEqual([
      ...BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS,
    ]);
    expect(
      entityInserts.every(
        (row) =>
          row.lifecycle_status === "approved" &&
          row.version_id === "version-1" &&
          row.tenant_id === "tenant-1",
      ),
    ).toBe(true);
    expect(entityInserts[0]).toMatchObject({
      slug: "customer",
      name: "Customer",
      broad_type: "entity",
    });
  });

  it("no-ops when the tenant already has an active ontology version", async () => {
    const db = new FakeBaselineDb([[{ id: "version-existing" }]]);

    const result = await ensureBaselineOntology(db as any, "tenant-1");

    expect(result).toEqual({
      seeded: false,
      versionId: "version-existing",
      entityTypeSlugs: [],
    });
    expect(db.inserts).toEqual([]);
  });

  it("yields to a concurrent bootstrap that activates a version first", async () => {
    const db = new FakeBaselineDb(
      // no active version at check time, no prior versions, then the raced
      // active version on the post-conflict reload
      [[], [], [{ id: "version-raced" }]],
      // version insert hits uq_ontology_versions_tenant_active → no row
      [[]],
    );

    const result = await ensureBaselineOntology(db as any, "tenant-1");

    expect(result).toEqual({
      seeded: false,
      versionId: "version-raced",
      entityTypeSlugs: [],
    });
    // Only the conflicted version insert was attempted — no entity types.
    expect(db.inserts).toHaveLength(1);
  });
});
