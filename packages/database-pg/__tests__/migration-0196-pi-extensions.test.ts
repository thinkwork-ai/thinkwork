import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0196 = readFileSync(
  join(HERE, "..", "drizzle", "0196_pi_extensions.sql"),
  "utf-8",
);

describe("migration 0196 - Pi extensions", () => {
  it("declares drift markers for extension registry tables, indexes, and constraints", () => {
    for (const marker of [
      "public.pi_extension_sources",
      "public.pi_extension_versions",
      "public.pi_extension_assignments",
      "public.uq_pi_extension_sources_tenant_repository",
      "public.uq_pi_extension_versions_source_commit",
      "public.uq_pi_extension_assignments_default_version",
      "public.uq_pi_extension_assignments_profile_version",
      "public.idx_pi_extension_sources_tenant",
      "public.idx_pi_extension_versions_tenant_status",
      "public.idx_pi_extension_versions_source",
      "public.idx_pi_extension_assignments_tenant_target",
      "public.idx_pi_extension_assignments_version",
      "public.pi_extension_sources.pi_extension_sources_source_type_check",
      "public.pi_extension_versions.pi_extension_versions_status_check",
      "public.pi_extension_assignments.pi_extension_assignments_target_type_check",
      "public.pi_extension_assignments.pi_extension_assignments_profile_target_check",
    ]) {
      expect(migration0196).toContain(`-- creates`);
      expect(migration0196).toContain(marker);
    }
  });

  it("uses additive idempotent DDL and preserves existing capability tables", () => {
    expect(migration0196).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.pi_extension_sources/i,
    );
    expect(migration0196).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.pi_extension_versions/i,
    );
    expect(migration0196).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.pi_extension_assignments/i,
    );
    expect(migration0196).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });

  it("keeps imported versions non-executable until approval and assignment", () => {
    expect(migration0196).toMatch(/status text NOT NULL DEFAULT 'imported'/i);
    expect(migration0196).toContain(
      "CHECK (status IN (\n      'imported',\n      'needs_review',\n      'approved',\n      'rejected',\n      'failed_verification'",
    );
    expect(migration0196).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.pi_extension_assignments/i,
    );
    expect(migration0196).toContain(
      "CHECK (\n      (target_type = 'agent_profile' AND agent_profile_id IS NOT NULL)",
    );
    expect(migration0196).toContain("WHERE target_type = 'default_agent'");
    expect(migration0196).toContain("WHERE target_type = 'agent_profile'");
  });
});
