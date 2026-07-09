import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ANALYST_SCHEMA_ANNOTATIONS } from "../src/analyst/annotations";
import {
  ANALYST_DENYLISTED_COLUMNS,
  ANALYST_DENYLISTED_TABLES,
  ANALYST_GRANTS_BEGIN_MARKER,
  ANALYST_GRANTS_END_MARKER,
  analystGrantSql,
  auditSensitiveCoverage,
  generateAnalystSchemaMarkdown,
  listAnalystTables,
} from "../src/analyst/semantic-model";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMITTED_PATH = join(HERE, "..", "generated", "analyst", "SCHEMA.md");
const MIGRATION_PATH = join(
  HERE,
  "..",
  "drizzle",
  "0227_analyst_reader_role.sql",
);

describe("analyst semantic model (THINK-228 U1)", () => {
  const doc = generateAnalystSchemaMarkdown();
  const tables = listAnalystTables();

  it("emits table sections with columns, FK join hints, and enum legends", () => {
    // threads: representative table with tenant FK + type/status enums.
    const threads = tables.find((t) => t.name === "threads");
    expect(threads).toBeDefined();
    expect(doc).toContain("## threads");
    expect(doc).toContain("| tenant_id | uuid |");
    expect(doc).toMatch(/- `threads\.tenant_id` → `tenants\.id`/);

    // Enum legend derived from a CHECK `col IN (...)` constraint.
    const enumTable = tables.find((t) => t.columns.some((c) => c.enumValues));
    expect(enumTable).toBeDefined();
    const enumColumn = enumTable!.columns.find((c) => c.enumValues)!;
    expect(doc).toContain(
      `- \`${enumColumn.name}\`: \`${enumColumn.enumValues![0]}\``,
    );
  });

  it("excludes denylisted secret-bearing tables from the model", () => {
    for (const denied of [
      "credentials",
      "webhooks",
      "routine_approval_tokens",
      "workos_auth_sessions",
    ]) {
      expect(ANALYST_DENYLISTED_TABLES.has(denied)).toBe(true);
      expect(tables.some((t) => t.name === denied)).toBe(false);
      expect(doc).not.toContain(`## ${denied}\n`);
    }
  });

  it("excludes non-public-schema tables from the model", () => {
    // wiki.pages, compliance.audit_events, brain.pages all exist in the
    // Drizzle exports but must not appear.
    expect(tables.some((t) => t.name === "audit_events")).toBe(false);
    expect(doc).not.toContain("## audit_events");
    expect(doc).not.toContain("## compile_jobs");
  });

  it("omits column-denylisted columns and marks them not granted", () => {
    const users = tables.find((t) => t.name === "users");
    expect(users).toBeDefined();
    expect(users!.columns.some((c) => c.name === "expo_push_token")).toBe(
      false,
    );
    expect(users!.deniedColumns).toContain("expo_push_token");
    expect(doc).toContain("Not granted (do not query): `expo_push_token`.");

    const mcpServers = tables.find((t) => t.name === "tenant_mcp_servers");
    expect(mcpServers).toBeDefined();
    expect(mcpServers!.columns.some((c) => c.name === "auth_config")).toBe(
      false,
    );
  });

  it("audits sensitive-looking columns to zero uncovered violations", () => {
    expect(auditSensitiveCoverage()).toEqual([]);
  });

  it("column denylist entries reference real tables", () => {
    const known = new Set(tables.map((t) => t.name));
    for (const tableName of Object.keys(ANALYST_DENYLISTED_COLUMNS)) {
      expect(
        known.has(tableName),
        `${tableName} in ANALYST_DENYLISTED_COLUMNS is not a live table`,
      ).toBe(true);
    }
  });

  it("is deterministic — regeneration is byte-identical", () => {
    expect(generateAnalystSchemaMarkdown()).toEqual(doc);
  });

  it("0227 migration grant section matches the current denylist (U2 sync gate)", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf-8");
    expect(migration).toContain("-- creates-role: analyst_reader");
    const begin = migration.indexOf(ANALYST_GRANTS_BEGIN_MARKER);
    const end = migration.indexOf(ANALYST_GRANTS_END_MARKER);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const section = migration
      .slice(begin + ANALYST_GRANTS_BEGIN_MARKER.length, end)
      .trim();
    expect(section).toEqual(analystGrantSql());
  });

  it("grant SQL never grants a denylisted table and column-grants mixed tables", () => {
    const grants = analystGrantSql();
    for (const denied of ANALYST_DENYLISTED_TABLES) {
      expect(grants).not.toContain(`GRANT SELECT ON public.${denied} `);
    }
    expect(grants).toContain(
      "REVOKE ALL PRIVILEGES ON public.users FROM analyst_reader;",
    );
    expect(grants).toMatch(
      /GRANT SELECT \([^)]*\bemail\b[^)]*\) ON public\.users TO analyst_reader;/,
    );
    expect(grants).not.toContain("expo_push_token");
  });

  it("committed SCHEMA.md matches the current schema (staleness gate, R4)", () => {
    // This is the R4 "cannot silently go stale" trigger: it runs in the
    // pre-commit/CI `pnpm test` gate, so a Drizzle schema change without a
    // regen fails here. Fix: npx tsx scripts/generate-analyst-schema.ts
    const committed = readFileSync(COMMITTED_PATH, "utf-8");
    expect(committed).toEqual(doc);
  });

  describe("operator annotation overlay (THINK-229 U7)", () => {
    it("renders the seeded table note and column note/PII warning in the expected sections", () => {
      const usersAnnotation = ANALYST_SCHEMA_ANNOTATIONS.users;
      expect(usersAnnotation).toBeDefined();
      expect(usersAnnotation!.note).toBeDefined();

      const start = doc.indexOf("## users\n");
      expect(start).toBeGreaterThan(-1);
      const end = doc.indexOf("\n## ", start + 1);
      const usersSection = doc.slice(start, end === -1 ? undefined : end);

      expect(usersSection).toContain(`Note: ${usersAnnotation!.note}`);
      const emailAnnotation = usersAnnotation!.columns!.email;
      expect(usersSection).toContain(emailAnnotation.note!);
      expect(usersSection).toContain("⚠ PII");
      // Both land in the same row.
      expect(usersSection).toMatch(/\| email \| text \| [^|]*⚠ PII[^|]*\|/);
    });

    it("an empty overlay produces the un-annotated baseline (no seeded note/PII markers)", () => {
      const bare = generateAnalystSchemaMarkdown({});
      expect(bare).not.toContain("⚠ PII");
      expect(bare).not.toContain(ANALYST_SCHEMA_ANNOTATIONS.users!.note);
      // Same table/column manifest — only the annotation-derived lines differ.
      expect(bare).toContain("## users");
      expect(bare).toContain("| email | text |  |");
    });

    it("throws a descriptive error for an annotation referencing an unknown table", () => {
      expect(() =>
        generateAnalystSchemaMarkdown({
          not_a_real_table: { note: "typo guard" },
        }),
      ).toThrow(/not_a_real_table/);
    });

    it("throws a descriptive error for an annotation referencing an unknown column", () => {
      expect(() =>
        generateAnalystSchemaMarkdown({
          users: { columns: { not_a_real_column: { note: "typo guard" } } },
        }),
      ).toThrow(/users\.not_a_real_column/);
    });

    it("a PII annotation never changes auditSensitiveCoverage's result", () => {
      // auditSensitiveCoverage takes no annotation input at all; assert the
      // result is identical regardless of whether the PII-flagged overlay
      // is in play, proving annotations have no path into the audit.
      const withoutAnnotations = auditSensitiveCoverage();
      generateAnalystSchemaMarkdown({}); // exercise the no-overlay path
      const withAnnotations = auditSensitiveCoverage();
      generateAnalystSchemaMarkdown(ANALYST_SCHEMA_ANNOTATIONS); // exercise the seeded PII overlay
      const afterSeededOverlay = auditSensitiveCoverage();

      expect(withAnnotations).toEqual(withoutAnnotations);
      expect(afterSeededOverlay).toEqual(withoutAnnotations);
      expect(withoutAnnotations).toEqual([]);
    });
  });
});
