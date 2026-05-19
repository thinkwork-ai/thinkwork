import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0104 = readFileSync(
  join(HERE, "..", "drizzle", "0104_expand_seed_ontology_for_user_memory.sql"),
  "utf-8",
);

describe("migration 0104 — user-memory ontology expansion", () => {
  it("declares a drift marker view", () => {
    expect(migration0104).toMatch(
      /--\s*creates:\s*public\.view_seed_ontology_user_memory_expanded\b/,
    );
    expect(migration0104).toMatch(
      /CREATE OR REPLACE VIEW public\.view_seed_ontology_user_memory_expanded\b/,
    );
  });

  it("seeds user-memory entity types and ontology relationships", () => {
    for (const slug of [
      "place",
      "venue",
      "trip",
      "preference",
      "project",
      "task",
    ]) {
      expect(migration0104).toContain(`('${slug}',`);
    }
    for (const slug of [
      "located_in",
      "visited_during",
      "about_place",
      "has_preference",
      "involves_person",
      "has_task",
      "has_decision",
    ]) {
      expect(migration0104).toContain(`('${slug}',`);
    }
  });
});
