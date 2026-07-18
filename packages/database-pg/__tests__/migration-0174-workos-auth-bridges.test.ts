import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0174 = readFileSync(
  join(HERE, "..", "drizzle", "0174_workos_auth_bridges.sql"),
  "utf-8",
);

describe("migration 0174 — WorkOS auth bridges", () => {
  it("declares migration markers and status checks", () => {
    for (const marker of [
      "public.workos_auth_bridges",
      "public.uq_workos_auth_bridges_code_digest",
      "public.idx_workos_auth_bridges_tenant_status",
      "public.idx_workos_auth_bridges_reference",
    ]) {
      expect(migration0174).toContain(`-- creates: ${marker}`);
    }
    expect(migration0174).toContain(
      "CHECK (status IN ('pending', 'consumed', 'expired'))",
    );
    expect(migration0174).toContain("bridge_code_digest text NOT NULL");
    expect(migration0174).not.toContain("bridge_code text");
  });
});
