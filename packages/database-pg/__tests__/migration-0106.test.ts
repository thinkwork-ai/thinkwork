import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0106 = readFileSync(
  join(HERE, "..", "drizzle", "0106_expand_seed_ontology_for_triples.sql"),
  "utf-8",
);

describe("migration 0106 — ontology triple expansion", () => {
  it("declares a drift marker view", () => {
    expect(migration0106).toMatch(
      /--\s*creates:\s*public\.view_seed_ontology_triples_expanded\b/,
    );
    expect(migration0106).toMatch(
      /CREATE OR REPLACE VIEW public\.view_seed_ontology_triples_expanded\b/,
    );
  });

  it("seeds activity plus relationship types needed for connected triples", () => {
    expect(migration0106).toContain("('activity', 'Activity'");
    for (const slug of [
      "lives_in",
      "visited",
      "interested_in",
      "takes_place_at",
      "has_order",
      "fulfilled_at",
      "serves_place",
      "related_case",
    ]) {
      expect(migration0106).toContain(`('${slug}',`);
    }
  });

  it("expands existing relationships to cover user-memory graph pairs", () => {
    expect(migration0106).toContain("'involves_person'");
    expect(migration0106).toContain("'support_case'");
    expect(migration0106).toContain("'activity'");
    expect(migration0106).toContain("'has_task'");
  });
});
