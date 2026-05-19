import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0103 = readFileSync(
  join(HERE, "..", "drizzle", "0103_brain_section_source_trigger_repair.sql"),
  "utf-8",
);

describe("migration 0103 — brain section-source trigger repair", () => {
  it("guards against wrong-database application", () => {
    expect(migration0103).toMatch(/IF current_database\(\)\s*!=\s*'thinkwork'/);
  });

  it("uses the canonical timeout and transaction pattern", () => {
    expect(migration0103).toMatch(/BEGIN;/);
    expect(migration0103).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(migration0103).toMatch(/SET LOCAL statement_timeout = '60s'/);
    expect(migration0103).toMatch(/COMMIT;/);
  });

  it("repoints the trigger function to brain schema tables", () => {
    expect(migration0103).toContain("FROM brain.page_sections s");
    expect(migration0103).toContain("INNER JOIN brain.pages p");
    expect(migration0103).not.toContain(
      "FROM public.tenant_entity_page_sections",
    );
    expect(migration0103).not.toContain(
      "INNER JOIN public.tenant_entity_pages",
    );
  });

  it("recreates the trigger on brain.section_sources", () => {
    expect(migration0103).toMatch(
      /DROP TRIGGER IF EXISTS trg_tenant_entity_section_sources_tenant\s+ON brain\.section_sources/,
    );
    expect(migration0103).toMatch(
      /CREATE TRIGGER trg_tenant_entity_section_sources_tenant\s+BEFORE INSERT OR UPDATE ON brain\.section_sources/,
    );
  });

  it("declares a drift marker view", () => {
    expect(migration0103).toMatch(
      /--\s*creates:\s*public\.view_brain_section_source_trigger_repaired\b/,
    );
    expect(migration0103).toMatch(
      /CREATE OR REPLACE VIEW public\.view_brain_section_source_trigger_repaired\b/,
    );
  });
});
