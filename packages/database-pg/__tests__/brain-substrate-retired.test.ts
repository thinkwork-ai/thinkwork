import { describe, expect, it } from "vitest";

import * as brainSchema from "../src/schema/brain";
import * as schemaBarrel from "../src/schema";

/**
 * THINK-290 U5: the retired graph-substrate tables (brain.substrate_states /
 * substrate_migrations / substrate_events) had zero application readers and
 * were removed from the Drizzle schema. The tables themselves are dropped by
 * a follow-up migration after this code deploys (def-removal-deploy-first
 * ordering). This test pins the absence so the defs don't silently return.
 */
describe("brain substrate retirement", () => {
  it("exports no substrate tables, relations, or enums", () => {
    for (const module_ of [brainSchema, schemaBarrel]) {
      const substrateExports = Object.keys(module_).filter((name) =>
        /substrate/i.test(name),
      );
      expect(substrateExports).toEqual([]);
    }
  });

  it("keeps artifact_manifests free of substrate linkage columns", () => {
    const columns = Object.keys(brainSchema.brainArtifactManifests);
    expect(columns).not.toContain("substrate_id");
    expect(columns).not.toContain("migration_id");
  });
});
