import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import config, { UNMANAGED_AUTH_ROLLBACK_TABLES } from "../drizzle.config";

const HERE = dirname(fileURLToPath(import.meta.url));
const dbPush = readFileSync(
  join(HERE, "..", "..", "..", "scripts", "db-push.sh"),
  "utf8",
);

describe("Drizzle auth phase safety", () => {
  it("keeps rollback-only WorkOS tables outside standard schema pushes", () => {
    expect(UNMANAGED_AUTH_ROLLBACK_TABLES).toEqual([
      "!workos_auth_bridges",
      "!workos_auth_sessions",
    ]);
    expect(config.tablesFilter).toEqual([
      "*",
      "!workos_auth_bridges",
      "!workos_auth_sessions",
    ]);
  });

  it("fails closed before push while rollback or transitional auth state exists", () => {
    const guard = dbPush.indexOf("AUTH_PHASE_STATE=$(psql");
    const push = dbPush.indexOf("npx drizzle-kit push --force");

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(push);
    expect(dbPush).toContain("to_regclass('public.workos_auth_bridges')");
    expect(dbPush).toContain("to_regclass('public.workos_auth_sessions')");
    expect(dbPush).toContain(
      "pg_get_constraintdef(constraint_record.oid) LIKE '%coexistence%'",
    );
    expect(dbPush).toContain(
      "pg_get_expr(default_record.adbin, default_record.adrelid) LIKE '%coexistence%'",
    );
    expect(dbPush).toContain('[ "$AUTH_PHASE_STATE" != "safe" ]');
  });
});
