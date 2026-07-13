import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0246 = readFileSync(
  join(HERE, "..", "drizzle", "0246_automation_workflow_ownership.sql"),
  "utf-8",
);

describe("migration 0246 — Automation Workflow ownership", () => {
  it("backfills every Automation projection from its source AgentLoop", () => {
    expect(migration0246).toContain("FROM public.agent_loops AS automation");
    expect(migration0246).toContain(
      "workflow.source_agent_loop_id = automation.id",
    );
    expect(migration0246).toContain(
      "workflow.tenant_id = automation.tenant_id",
    );
  });

  it("makes projections private and copies both owner identities", () => {
    expect(migration0246).toContain("visibility = 'agent_private'");
    expect(migration0246).toContain(
      "owner_user_id = automation.owner_user_id",
    );
    expect(migration0246).toContain(
      "owner_agent_id = automation.owner_agent_id",
    );
  });

  it("declares and creates the partial lookup index", () => {
    expect(migration0246).toMatch(
      /-- creates: public\.workflows_source_owner_idx/,
    );
    expect(migration0246).toContain(
      "CREATE INDEX IF NOT EXISTS workflows_source_owner_idx",
    );
    expect(migration0246).toContain("WHERE source_agent_loop_id IS NOT NULL");
  });
});
