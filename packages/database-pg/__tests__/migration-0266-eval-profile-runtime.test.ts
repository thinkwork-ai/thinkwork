import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../drizzle/0266_eval_profiles_runtime_type.sql"),
  "utf8",
);

describe("migration 0266 eval profile runtime", () => {
  it("adds an idempotent Pi-defaulted runtime pin with a closed value set", () => {
    expect(migration).toContain(
      "-- creates-column: public.eval_profiles.runtime_type",
    );
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS runtime_type text NOT NULL DEFAULT 'pi'/,
    );
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS/);
    expect(migration).toMatch(
      /CHECK \(runtime_type IN \('pi', 'agentcore'\)\)/,
    );
  });
});
