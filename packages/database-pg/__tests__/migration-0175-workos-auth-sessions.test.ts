import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0175 = readFileSync(
  join(HERE, "..", "drizzle", "0175_workos_auth_sessions.sql"),
  "utf-8",
);

describe("migration 0175 — WorkOS auth sessions", () => {
  it("declares migration markers and status checks", () => {
    for (const marker of [
      "public.workos_auth_sessions",
      "public.idx_workos_auth_sessions_cognito_active",
      "public.idx_workos_auth_sessions_user_active",
      "public.idx_workos_auth_sessions_workos_session",
    ]) {
      expect(migration0175).toContain(`-- creates: ${marker}`);
    }
    expect(migration0175).toContain(
      "-- creates-column: public.workos_auth_bridges.workos_session_expires_at",
    );
    expect(migration0175).toContain(
      "CHECK (status IN ('active', 'logged_out', 'expired'))",
    );
    expect(migration0175).not.toContain("access_token");
    expect(migration0175).not.toContain("refresh_token");
  });
});
