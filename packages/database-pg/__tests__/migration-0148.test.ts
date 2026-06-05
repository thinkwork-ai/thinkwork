import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { budgetPolicies, costEvents, scheduledJobs } from "../src/schema/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0148 = readFileSync(
  join(HERE, "..", "drizzle", "0148_user_cost_attribution.sql"),
  "utf-8",
);
const rollback0148 = readFileSync(
  join(HERE, "..", "drizzle", "0148_user_cost_attribution_rollback.sql"),
  "utf-8",
);
const costTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "costs.graphql"),
  "utf-8",
);
const subscriptionTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "subscriptions.graphql"),
  "utf-8",
);
const scheduledJobTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "scheduled-jobs.graphql"),
  "utf-8",
);
const generatedGraphqlFiles = [
  join(HERE, "..", "..", "..", "apps", "admin", "src", "gql", "graphql.ts"),
  join(HERE, "..", "..", "..", "apps", "cli", "src", "gql", "graphql.ts"),
  join(HERE, "..", "..", "..", "apps", "mobile", "lib", "gql", "graphql.ts"),
  join(HERE, "..", "..", "..", "apps", "spaces", "src", "gql", "graphql.ts"),
].map((path) => readFileSync(path, "utf-8"));

const generatedTypeBlock = (source: string, typeName: string) => {
  const match = source.match(
    new RegExp(`export type ${typeName} = \\{[\\s\\S]*?\\n\\};`),
  );
  expect(match, `generated type ${typeName} should exist`).not.toBeNull();
  return match![0];
};

describe("migration 0148 — user cost attribution", () => {
  it("adds nullable user ownership to cost events and budget policies", () => {
    const costColumns = getTableColumns(costEvents);
    expect(costColumns.user_id.notNull).toBe(false);

    const budgetColumns = getTableColumns(budgetPolicies);
    expect(budgetColumns.user_id.notNull).toBe(false);
  });

  it("adds explicit budget pause state to scheduled jobs", () => {
    const columns = getTableColumns(scheduledJobs);

    expect(columns.budget_paused.notNull).toBe(true);
    expect(columns.budget_paused.default).toBe(false);
    expect(columns.budget_paused_at.notNull).toBe(false);
    expect(columns.budget_paused_reason.notNull).toBe(false);
  });

  it("declares drift markers for added columns, indexes, and constraints", () => {
    for (const marker of [
      "public.cost_events.user_id",
      "public.budget_policies.user_id",
      "public.scheduled_jobs.budget_paused",
      "public.scheduled_jobs.budget_paused_at",
      "public.scheduled_jobs.budget_paused_reason",
    ]) {
      expect(migration0148).toMatch(
        new RegExp(`--\\s*creates-column:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "public.idx_cost_events_user_created",
      "public.idx_budget_policies_user",
      "public.idx_scheduled_jobs_budget_paused",
    ]) {
      expect(migration0148).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
      expect(migration0148).toContain(marker.replace("public.", ""));
    }

    for (const marker of [
      "public.cost_events.cost_events_user_id_users_id_fk",
      "public.budget_policies.budget_policies_user_id_users_id_fk",
      "public.budget_policies.budget_policies_scope_check",
      "public.budget_policies.budget_policies_scope_shape_check",
    ]) {
      expect(migration0148).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
    }
  });

  it("backfills only deterministic thread-owned cost events", () => {
    expect(migration0148).toMatch(
      /UPDATE public\.cost_events ce\s+SET user_id = batch\.user_id\s+FROM batch/s,
    );
    expect(migration0148).toContain("ON t.id = ce.thread_id");
    expect(migration0148).toContain("AND t.tenant_id = ce.tenant_id");
    expect(migration0148).toContain("ce.user_id IS NULL");
    expect(migration0148).toContain("t.user_id IS NOT NULL");
    expect(migration0148).toContain("LIMIT batch_size");
    expect(migration0148).toContain("FOR UPDATE OF ce SKIP LOCKED");
    expect(migration0148).toContain(
      "CALL public.backfill_cost_events_user_id_0148(5000)",
    );
    expect(migration0148).not.toMatch(/FROM public\.users\s+u/i);
  });

  it("uses lock-safe migration primitives for hot tables", () => {
    expect(migration0148).toContain("\\set ON_ERROR_STOP on");
    expect(migration0148).toContain("SET lock_timeout = '5s'");
    expect(migration0148).not.toMatch(/^BEGIN;$/m);
    expect(migration0148).not.toMatch(/^COMMIT;$/m);
    expect(migration0148).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(migration0148).toContain("NOT VALID");
    expect(migration0148).toContain("VALIDATE CONSTRAINT");
  });

  it("allows user budget scope and prevents ambiguous scope shapes", () => {
    expect(migration0148).toContain("scope IN ('tenant', 'agent', 'user')");
    expect(migration0148).toContain("budget_policies_scope_shape_check");
    expect(migration0148).toContain(
      "scope = 'tenant' AND agent_id IS NULL AND user_id IS NULL",
    );
    expect(migration0148).toContain(
      "scope = 'agent' AND agent_id IS NOT NULL AND user_id IS NULL",
    );
    expect(migration0148).toContain(
      "scope = 'user' AND agent_id IS NULL AND user_id IS NOT NULL",
    );
  });

  it("exposes user cost attribution and user budget APIs in GraphQL source types", () => {
    expect(costTypes).toMatch(/type CostEvent[\s\S]*userId: ID/);
    expect(costTypes).toMatch(/type BudgetPolicy[\s\S]*userId: ID/);
    expect(costTypes).toMatch(/input UpsertBudgetPolicyInput[\s\S]*userId: ID/);
    expect(costTypes).toContain("type UserCostSummary");
    expect(costTypes).toContain("costByUser(");
    expect(costTypes).toContain("userBudgetStatus(");
    expect(costTypes).toContain("unpauseUserBudget(");
    expect(subscriptionTypes).toMatch(
      /type CostRecordedEvent[\s\S]*userId: ID/,
    );
    expect(subscriptionTypes).toMatch(/notifyCostRecorded\([\s\S]*userId: ID/);
    expect(scheduledJobTypes).toMatch(
      /type ScheduledJob[\s\S]*budgetPaused: Boolean!/,
    );
    expect(scheduledJobTypes).toMatch(
      /type ScheduledJob[\s\S]*budgetPausedAt: AWSDateTime/,
    );
    expect(scheduledJobTypes).toMatch(
      /type ScheduledJob[\s\S]*budgetPausedReason: String/,
    );
  });

  it("keeps generated GraphQL clients aligned with user cost and budget APIs", () => {
    for (const generated of generatedGraphqlFiles) {
      const budgetPolicy = generatedTypeBlock(generated, "BudgetPolicy");
      const scheduledJob = generatedTypeBlock(generated, "ScheduledJob");
      const userCostSummary = generatedTypeBlock(generated, "UserCostSummary");
      const upsertBudgetPolicyInput = generatedTypeBlock(
        generated,
        "UpsertBudgetPolicyInput",
      );

      expect(budgetPolicy).toMatch(
        /userId\?: Maybe<Scalars\["ID"\]\["output"\]>/,
      );
      expect(scheduledJob).toMatch(
        /budgetPaused: Scalars\["Boolean"\]\["output"\]/,
      );
      expect(scheduledJob).toMatch(
        /budgetPausedAt\?: Maybe<Scalars\["AWSDateTime"\]\["output"\]>/,
      );
      expect(scheduledJob).toMatch(
        /budgetPausedReason\?: Maybe<Scalars\["String"\]\["output"\]>/,
      );
      expect(userCostSummary).toMatch(
        /userId\?: Maybe<Scalars\["ID"\]\["output"\]>/,
      );
      expect(userCostSummary).toMatch(
        /userName: Scalars\["String"\]\["output"\]/,
      );
      expect(userCostSummary).toMatch(
        /isSystem: Scalars\["Boolean"\]\["output"\]/,
      );
      expect(upsertBudgetPolicyInput).toMatch(
        /userId\?: InputMaybe<Scalars\["ID"\]\["input"\]>/,
      );
    }
  });

  it("rolls back the user attribution columns, indexes, and constraints", () => {
    for (const statement of [
      "DROP INDEX CONCURRENTLY IF EXISTS public.idx_scheduled_jobs_budget_paused",
      "DROP INDEX CONCURRENTLY IF EXISTS public.idx_budget_policies_user",
      "DROP INDEX CONCURRENTLY IF EXISTS public.idx_cost_events_user_created",
      "DROP CONSTRAINT IF EXISTS budget_policies_scope_shape_check",
      "DROP CONSTRAINT IF EXISTS budget_policies_scope_check",
      "DROP CONSTRAINT IF EXISTS budget_policies_user_id_users_id_fk",
      "DROP CONSTRAINT IF EXISTS cost_events_user_id_users_id_fk",
      "ALTER TABLE IF EXISTS public.budget_policies",
      "ALTER TABLE IF EXISTS public.cost_events",
      "DROP COLUMN IF EXISTS budget_paused",
      "DROP COLUMN IF EXISTS budget_paused_at",
      "DROP COLUMN IF EXISTS budget_paused_reason",
      "DROP COLUMN IF EXISTS user_id",
    ]) {
      expect(rollback0148).toContain(statement);
    }
    expect(rollback0148).toContain("\\set ON_ERROR_STOP on");
    expect(rollback0148).toContain("explicit acceptance of that data loss");
  });
});
