/**
 * Hindsight database client seam (THINK-220 Phase 1).
 *
 * The seam ships inert: with HINDSIGHT_DATABASE_NAME unset, every helper
 * must degrade to the exact status quo (primary handle, `hindsight.`
 * prefix). These tests pin both modes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildDatabaseUrl } from "../src/db";
import {
  getHindsightDb,
  hindsightDatabaseName,
  hindsightSchemaPrefix,
  hindsightSql,
  resetHindsightDbForTests,
  resolveHindsightDb,
} from "../src/hindsight-db";

const dialect = new PgDialect();

beforeEach(() => {
  resetHindsightDbForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetHindsightDbForTests();
});

describe("hindsightDatabaseName / hindsightSchemaPrefix", () => {
  it("defaults to the shared-database mode when the env var is unset", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "");
    expect(hindsightDatabaseName()).toBeUndefined();
    expect(hindsightSchemaPrefix()).toBe("hindsight.");
  });

  it("switches to public schema when the env var names a database", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    expect(hindsightDatabaseName()).toBe("thinkwork_hindsight");
    expect(hindsightSchemaPrefix()).toBe("public.");
  });

  it("reads the env var at call time, not module load", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "");
    expect(hindsightSchemaPrefix()).toBe("hindsight.");
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    expect(hindsightSchemaPrefix()).toBe("public.");
  });
});

describe("hindsightSql", () => {
  it("renders the qualifier inline in a query template", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "");
    const query = dialect.sqlToQuery(
      sql`SELECT count(*) FROM ${hindsightSql()}memory_units WHERE document_id = ${"t-1"}`,
    );
    expect(query.sql).toBe(
      "SELECT count(*) FROM hindsight.memory_units WHERE document_id = $1",
    );

    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    const flipped = dialect.sqlToQuery(
      sql`SELECT count(*) FROM ${hindsightSql()}memory_units WHERE document_id = ${"t-1"}`,
    );
    expect(flipped.sql).toBe(
      "SELECT count(*) FROM public.memory_units WHERE document_id = $1",
    );
  });
});

describe("resolveHindsightDb", () => {
  it("returns the caller's handle untouched when the env var is unset", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "");
    const injected = { execute: vi.fn() };
    expect(resolveHindsightDb(injected)).toBe(injected);
  });

  it("returns the dedicated client when the env var is set", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://u:p@localhost:5432/thinkwork?sslmode=no-verify",
    );
    const injected = { execute: vi.fn() };
    const resolved = resolveHindsightDb(injected);
    expect(resolved).not.toBe(injected);
    expect(resolved).toBe(getHindsightDb());
  });
});

describe("getHindsightDb", () => {
  it("is a singleton per process in dedicated mode", () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://u:p@localhost:5432/thinkwork?sslmode=no-verify",
    );
    expect(getHindsightDb()).toBe(getHindsightDb());
  });
});

describe("buildDatabaseUrl database override", () => {
  it("swaps only the path segment of DATABASE_URL", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:p%40ss@db.example.com:5432/thinkwork?sslmode=no-verify",
    );
    expect(buildDatabaseUrl("thinkwork_hindsight")).toBe(
      "postgresql://user:p%40ss@db.example.com:5432/thinkwork_hindsight?sslmode=no-verify",
    );
  });

  it("passes the override through component-based construction", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_HOST", "db.example.com");
    vi.stubEnv("DATABASE_PASSWORD", "pw");
    expect(buildDatabaseUrl("thinkwork_hindsight")).toBe(
      "postgresql://thinkwork_admin:pw@db.example.com:5432/thinkwork_hindsight?sslmode=no-verify",
    );
  });
});
