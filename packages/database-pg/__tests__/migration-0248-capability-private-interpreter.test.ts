import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0248_capability_private_interpreter.sql"),
  "utf-8",
);

describe("migration 0248 — capability-private interpreter id", () => {
  it("declares and adds the additive tenants column", () => {
    expect(migration).toContain(
      "-- creates-column: public.tenants.sandbox_interpreter_capability_private_id",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS sandbox_interpreter_capability_private_id text",
    );
    expect(migration).toContain("ALTER TABLE public.tenants");
  });

  it("is purely additive — no drops, no rewrites of existing sandbox columns", () => {
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
    expect(migration).not.toMatch(/sandbox_interpreter_public_id/);
    expect(migration).not.toMatch(/sandbox_interpreter_internal_id/);
  });
});
