import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0102 = readFileSync(
  join(HERE, "..", "drizzle", "0102_wiki_brain_owner_repair.sql"),
  "utf-8",
);

describe("migration 0102 — wiki/brain owner repair", () => {
  it("guards against wrong-database application", () => {
    expect(migration0102).toMatch(/IF current_database\(\)\s*!=\s*'thinkwork'/);
  });

  it("uses the canonical timeout and transaction pattern", () => {
    expect(migration0102).toMatch(/BEGIN;/);
    expect(migration0102).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(migration0102).toMatch(/SET LOCAL statement_timeout = '60s'/);
    expect(migration0102).toMatch(/COMMIT;/);
  });

  it("declares a drift marker view", () => {
    expect(migration0102).toMatch(
      /--\s*creates:\s*public\.view_wiki_brain_owner_repaired\b/,
    );
    expect(migration0102).toMatch(
      /CREATE OR REPLACE VIEW public\.view_wiki_brain_owner_repaired\b/,
    );
  });

  it("transfers every wiki and brain table to the applying role", () => {
    for (const table of [
      "wiki.pages",
      "wiki.page_sections",
      "wiki.page_links",
      "wiki.page_aliases",
      "wiki.unresolved_mentions",
      "wiki.section_sources",
      "wiki.compile_jobs",
      "wiki.compile_cursors",
      "wiki.places",
      "brain.pages",
      "brain.page_sections",
      "brain.page_links",
      "brain.page_aliases",
      "brain.section_sources",
      "brain.external_refs",
    ]) {
      expect(migration0102).toMatch(
        new RegExp(
          `ALTER TABLE ${table.replace(".", "\\.")} OWNER TO CURRENT_USER`,
        ),
      );
    }
  });
});
