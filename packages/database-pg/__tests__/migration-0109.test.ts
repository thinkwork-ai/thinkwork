import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0109 = readFileSync(
  join(HERE, "..", "drizzle", "0109_space_owned_threads.sql"),
  "utf-8",
);

describe("migration 0109 — Space-owned Threads", () => {
  it("seeds the default Spaces used to parent existing Threads", () => {
    expect(migration0109).toContain("'general'");
    expect(migration0109).toContain("'customer-onboarding'");
    expect(migration0109).toContain("ON CONFLICT (tenant_id, slug)");
  });

  it("backfills orphan Threads before enforcing the invariant", () => {
    expect(migration0109).toMatch(/UPDATE public\.threads t\s+SET\s+space_id/s);
    expect(migration0109).toContain("AND t.space_id IS NULL");
    expect(migration0109).toContain(
      "ALTER TABLE public.threads\n  ALTER COLUMN space_id SET NOT NULL",
    );
  });

  it("declares drift markers for the required Space constraints", () => {
    expect(migration0109).toMatch(
      /--\s*creates-constraint:\s*public\.threads\.threads_space_id_required\b/,
    );
    expect(migration0109).toMatch(
      /--\s*creates-constraint:\s*public\.thread_participants\.thread_participants_space_id_required\b/,
    );
  });
});
