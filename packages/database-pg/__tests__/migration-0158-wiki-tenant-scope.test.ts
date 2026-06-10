import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  wikiCompileCursors,
  wikiCompileJobs,
  wikiPages,
  wikiPlaces,
  wikiUnresolvedMentions,
} from "../src/schema/wiki";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0158_wiki_tenant_scope.sql"),
  "utf-8",
);

describe("wiki tenant-scope covenant (plan 2026-06-09-004 U9)", () => {
  it("allows null owner_id on wiki.pages and wiki.compile_jobs (tenant scope)", () => {
    expect(getTableColumns(wikiPages).owner_id.notNull).toBe(false);
    expect(getTableColumns(wikiCompileJobs).owner_id.notNull).toBe(false);
  });

  it("keeps every other compiled-memory table strictly owner-scoped", () => {
    expect(getTableColumns(wikiUnresolvedMentions).owner_id.notNull).toBe(true);
    expect(getTableColumns(wikiPlaces).owner_id.notNull).toBe(true);
    expect(getTableColumns(wikiCompileCursors).owner_id.notNull).toBe(true);
  });

  it("declares the tenant-scope partial unique index alongside the four-column unique", () => {
    const { indexes } = getTableConfig(wikiPages);
    const names = indexes.map((idx) => idx.config.name);
    // Integrity-load-bearing: the four-column unique treats NULL owner_id
    // as distinct, so without the partial index duplicate tenant pages
    // would insert silently.
    expect(names).toContain("uq_pages_tenant_type_slug_tenant_scope");
    expect(names).toContain("uq_pages_tenant_owner_type_slug");

    const tenantScope = indexes.find(
      (idx) => idx.config.name === "uq_pages_tenant_type_slug_tenant_scope",
    )!;
    expect(tenantScope.config.unique).toBe(true);
    expect(tenantScope.config.where).toBeDefined();
    expect(
      tenantScope.config.columns.map((col) => (col as { name?: string }).name),
    ).toEqual(["tenant_id", "type", "slug"]);
  });
});

describe("migration 0158 — wiki tenant scope", () => {
  it("declares the drift-reporter marker for the new index", () => {
    expect(migration).toMatch(
      /--\s*creates:\s*wiki\.uq_pages_tenant_type_slug_tenant_scope\b/,
    );
  });

  it("drops NOT NULL on both owner_id columns and nothing else", () => {
    expect(migration).toMatch(
      /ALTER TABLE wiki\.pages\s+ALTER COLUMN owner_id DROP NOT NULL/,
    );
    expect(migration).toMatch(
      /ALTER TABLE wiki\.compile_jobs\s+ALTER COLUMN owner_id DROP NOT NULL/,
    );
    // Purely additive — no drops, no data changes.
    expect(migration).not.toMatch(/DROP TABLE|DROP INDEX|DELETE FROM|UPDATE /);
  });

  it("creates the partial unique index on (tenant_id, type, slug) WHERE owner_id IS NULL", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pages_tenant_type_slug_tenant_scope\s+ON wiki\.pages \(tenant_id, type, slug\)\s+WHERE owner_id IS NULL/,
    );
  });

  it("wraps the migration in a transaction with a lock timeout", () => {
    expect(migration).toMatch(/BEGIN;/);
    expect(migration).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(migration).toMatch(/COMMIT;/);
  });
});
