import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const REPORTER = join(REPO_ROOT, "scripts", "db-migrate-manual.sh");
const DEPLOY_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "deploy.yml");

function dryRunReport(): string {
  const result = spawnSync(
    "bash",
    [
      REPORTER,
      "--dry-run",
      "0067_thinkwork_computers_phase_one.sql",
      "0069_compliance_schema.sql",
      "0076_scheduled_jobs_marco_backfill.sql",
      "0079_seed_tenant_customize_catalog.sql",
      "0131_drop_skill_catalog_and_tenant_skills.sql",
      "0145_knowledge_graph_thread_ingest.sql",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, AUTH_RETIREMENT_PHASE: "coexistence" },
    },
  );

  expect(result.status).toBe(0);
  return result.stdout;
}

describe("manual migration drift reporter", () => {
  const report = dryRunReport();

  it("uses the latest declared migration state for retired objects", () => {
    expect(report).toContain("0067_thinkwork_computers_phase_one.sql");
    expect(report).toContain(
      "creates: public.computers -> SUPERSEDED by 0132_drop_computer_tables.sql",
    );
    expect(report).toContain("creates: compliance.audit_events -> ACTIVE");
    expect(report).toContain(
      "creates: public.idx_kg_ingest_runs_tenant_status -> MOVED to kg.idx_kg_ingest_runs_tenant_status by 0250_kg_schema_extraction.sql",
    );
    expect(report).toContain(
      "drops: public.skill_catalog -> SUPERSEDED by 0144_skill_catalog_index.sql",
    );
  });

  it("recognizes intentional data-only migrations without weakening schema checks", () => {
    expect(report).toContain("0076_scheduled_jobs_marco_backfill.sql");
    expect(report).toContain("DATA-ONLY (no durable schema objects)");
    expect(report).not.toContain("UNVERIFIED");
  });

  it("does not recreate retired migration tombstones during deployment", () => {
    const workflow = readFileSync(DEPLOY_WORKFLOW, "utf8");

    expect(workflow).not.toContain("0089_remove_maniflow_eval_seeds.sql");
    expect(workflow).not.toContain("0096_true_redteam_eval_seed_cleanup.sql");
  });
});
