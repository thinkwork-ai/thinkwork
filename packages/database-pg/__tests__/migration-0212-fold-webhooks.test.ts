import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0212 = readFileSync(
  join(HERE, "..", "drizzle", "0212_fold_webhooks_into_automations.sql"),
  "utf-8",
);

// THINK-137 U8 (R8): the webhook→Automation fold migration. These pin the
// load-bearing invariants of the pure-SQL migration so a future edit can't
// silently drop them.
describe("migration 0212 — fold webhooks into Automations", () => {
  it("only converts the agent|routine, non-connector, not-yet-converted set", () => {
    expect(migration0212).toContain("target_type IN ('agent', 'routine')");
    expect(migration0212).toContain("connect_provider_id IS NULL");
    expect(migration0212).toContain("agent_loop_id IS NULL");
  });

  it("leaves connector-created and task webhooks untouched", () => {
    // The convertible filter excludes connector rows; 'task' is not in the set.
    expect(migration0212).not.toMatch(/target_type\s*=\s*'task'\s+.*UPDATE/i);
    // The summary view still counts task + connector rows as survivors.
    expect(migration0212).toContain("task_webhooks");
    expect(migration0212).toContain("connector_webhooks");
  });

  it("preserves the token by UPDATE (never re-mints) and flips target_type", () => {
    expect(migration0212).toContain("UPDATE public.webhooks");
    expect(migration0212).toContain("target_type = 'automation'");
    // No new token is generated for the existing row.
    expect(migration0212).not.toContain("gen_random_bytes");
  });

  it("maps agent targets to agent_thread and routine targets to routine", () => {
    expect(migration0212).toContain("'kind', 'agent_thread'");
    expect(migration0212).toContain("'workerType', 'agent'");
    expect(migration0212).toContain("'threadMode', 'new_per_run'");
    expect(migration0212).toContain("'kind', 'routine'");
    expect(migration0212).toContain("'routineId', w.routine_id");
  });

  it("writes the NOT-NULL legacy spec defaults saveAgentLoop uses", () => {
    expect(migration0212).toContain("'family', 'webhook'");
    expect(migration0212).toContain("'mode', 'self_check'");
    expect(migration0212).toContain("'maxIterations', 1");
    expect(migration0212).toContain("'failBehavior', 'return_blocker'");
  });

  it("disables NULL-space agent automations and files a dedup inbox item", () => {
    expect(migration0212).toContain("automation_needs_space");
    expect(migration0212).toContain("NOT EXISTS");
    expect(migration0212).toContain("'agent_loop'");
  });

  it("is idempotent + guarded: advisory lock, pre-flight, drift-marker view", () => {
    expect(migration0212).toContain("pg_advisory_xact_lock");
    expect(migration0212).toContain("pre-flight");
    expect(migration0212).toMatch(
      /--\s*creates:\s*public\.view_webhooks_folded_into_automations/,
    );
    expect(migration0212).toContain(
      "CREATE OR REPLACE VIEW public.view_webhooks_folded_into_automations",
    );
  });
});
