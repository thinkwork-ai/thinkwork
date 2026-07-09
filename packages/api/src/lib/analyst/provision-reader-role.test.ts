/**
 * provisionReaderRole tests (THINK-239) — the runbook posture applied
 * programmatically. Asserts the create-vs-rotate branch, the exact hardening
 * statements, SELECT-only grants, PUBLIC revokes, and identifier safety.
 */

import { describe, expect, it, vi } from "vitest";

import {
  assertSafeIdentifier,
  generateReaderPassword,
  provisionReaderRole,
  readerRoleName,
  type ProvisionClient,
} from "./provision-reader-role.js";

function fakeClient(roleExists: boolean) {
  const queries: { text: string; params?: unknown[] }[] = [];
  const client: ProvisionClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.startsWith("SELECT 1 FROM pg_roles")) {
        return { rows: roleExists ? [{ "?column?": 1 }] : [] };
      }
      return { rows: [] };
    }),
  };
  return { client, queries };
}

describe("readerRoleName", () => {
  it("underscores hyphens and truncates to 63 chars", () => {
    expect(readerRoleName("sales-pg")).toBe("sales_pg_reader");
    const long = "a".repeat(80);
    expect(readerRoleName(long).length).toBe(63);
  });
});

describe("generateReaderPassword", () => {
  it("produces a 32+ char base64url secret with no quote chars", () => {
    const pw = generateReaderPassword();
    expect(pw.length).toBeGreaterThanOrEqual(32);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("assertSafeIdentifier", () => {
  it("rejects anything outside ^[a-z0-9_]+$", () => {
    expect(() => assertSafeIdentifier("ok_name1", "role")).not.toThrow();
    expect(() => assertSafeIdentifier("Bad-Name", "role")).toThrow(
      /not a safe SQL identifier/,
    );
    expect(() => assertSafeIdentifier('x"; DROP', "database")).toThrow();
  });
});

describe("provisionReaderRole", () => {
  it("CREATEs the role with pinned attributes when absent, then hardens + grants", async () => {
    const { client, queries } = fakeClient(false);
    await provisionReaderRole({
      client,
      database: "sales",
      roleName: "sales_pg_reader",
      password: "pw-Abc_123",
    });
    const texts = queries.map((q) => q.text);

    // Existence check is parameterized (never interpolated).
    expect(queries[0]!.text).toContain("SELECT 1 FROM pg_roles");
    expect(queries[0]!.params).toEqual(["sales_pg_reader"]);

    const create = texts.find((t) => t.startsWith("CREATE ROLE"))!;
    expect(create).toContain('CREATE ROLE "sales_pg_reader" WITH LOGIN');
    expect(create).toContain("PASSWORD 'pw-Abc_123'");
    expect(create).toContain(
      "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION",
    );
    expect(texts.some((t) => t.startsWith("ALTER ROLE"))).toBe(true);

    // Session defaults.
    expect(
      texts.some((t) => t.includes("SET default_transaction_read_only = on")),
    ).toBe(true);
    expect(texts.some((t) => t.includes("SET statement_timeout = '15s'"))).toBe(
      true,
    );
    expect(
      texts.some((t) =>
        t.includes("SET idle_in_transaction_session_timeout = '30s'"),
      ),
    ).toBe(true);
    expect(texts.some((t) => t.includes("SET search_path = public"))).toBe(
      true,
    );

    // SELECT-only grant surface on public only.
    expect(
      texts.some((t) =>
        t.includes('GRANT CONNECT ON DATABASE "sales" TO "sales_pg_reader"'),
      ),
    ).toBe(true);
    expect(
      texts.some((t) => t.includes("GRANT USAGE ON SCHEMA public")),
    ).toBe(true);
    expect(
      texts.some((t) => t.includes("GRANT SELECT ON ALL TABLES IN SCHEMA public")),
    ).toBe(true);
    expect(
      texts.some((t) =>
        t.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT"),
      ),
    ).toBe(true);

    // PUBLIC revokes.
    expect(
      texts.some((t) => t === "REVOKE CREATE ON SCHEMA public FROM PUBLIC"),
    ).toBe(true);
    expect(
      texts.some((t) => t.includes('REVOKE TEMP ON DATABASE "sales" FROM PUBLIC')),
    ).toBe(true);

    // Never a CREATE ROLE when re-running; here it's the fresh path so no ALTER PASSWORD-only.
    expect(texts.filter((t) => t.startsWith("CREATE ROLE")).length).toBe(1);
  });

  it("rotates the password (no attribute re-set) when the role already exists", async () => {
    const { client, queries } = fakeClient(true);
    await provisionReaderRole({
      client,
      database: "sales",
      roleName: "sales_pg_reader",
      password: "new-Pw_9",
    });
    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.startsWith("CREATE ROLE"))).toBe(false);
    expect(
      texts.some(
        (t) => t === `ALTER ROLE "sales_pg_reader" WITH PASSWORD 'new-Pw_9'`,
      ),
    ).toBe(true);
    // Grants are still re-applied on the retry path.
    expect(
      texts.some((t) => t.includes("GRANT SELECT ON ALL TABLES IN SCHEMA public")),
    ).toBe(true);
  });

  it("refuses an unsafe database identifier before any statement", async () => {
    const { client, queries } = fakeClient(false);
    await expect(
      provisionReaderRole({
        client,
        database: 'sales"; DROP DATABASE x; --',
        roleName: "sales_pg_reader",
        password: "pw_123456789012345678901234567890",
      }),
    ).rejects.toThrow(/not a safe SQL identifier/);
    expect(queries.length).toBe(0);
  });
});
