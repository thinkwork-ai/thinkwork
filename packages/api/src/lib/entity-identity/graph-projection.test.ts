import { afterAll, beforeAll, describe, expect, it } from "vitest";

// uploadIdentitySnapshot resolves the bucket from env at call time.
const previousBucket = process.env.BRAIN_ARTIFACTS_BUCKET;
beforeAll(() => {
  process.env.BRAIN_ARTIFACTS_BUCKET = "test-brain-artifacts";
});
afterAll(() => {
  if (previousBucket === undefined) {
    delete process.env.BRAIN_ARTIFACTS_BUCKET;
  } else {
    process.env.BRAIN_ARTIFACTS_BUCKET = previousBucket;
  }
});
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import { buildIdentitySnapshot } from "./graph-projection.js";

describe("buildIdentitySnapshot", () => {
  it("excludes private mappings and archived canonicals; carries redirects", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [
        {
          source_system: "twenty",
          external_id: "cmp_889",
          canonical_entity_id: "can-777",
          visibility: "tenant",
          entity_type_slug: "customer",
          status: "active",
          merged_into_id: null,
        },
        {
          source_system: "gmail",
          external_id: "x@y.z",
          canonical_entity_id: "can-priv",
          visibility: "private",
          entity_type_slug: "person",
          status: "active",
          merged_into_id: null,
        },
        {
          source_system: "twenty",
          external_id: "cmp_old",
          canonical_entity_id: "can-archived",
          visibility: "tenant",
          entity_type_slug: "customer",
          status: "archived",
          merged_into_id: null,
        },
      ],
      [{ id: "can-loser", merged_into_id: "can-777" }],
    );

    const snapshot = await buildIdentitySnapshot({
      tenantId: "tenant-1",
      cursor: "c1",
      db: fake.db as never,
    });
    expect(snapshot.mappings).toHaveLength(1);
    expect(snapshot.mappings[0].externalId).toBe("cmp_889");
    expect(snapshot.redirects).toEqual([
      { fromCanonicalEntityId: "can-loser", toCanonicalEntityId: "can-777" },
    ]);
  });
});
