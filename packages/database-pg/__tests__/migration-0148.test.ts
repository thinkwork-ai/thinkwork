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
    ]) {
      expect(migration0148).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
    }
  });

  it("backfills only deterministic thread-owned cost events", () => {
    expect(migration0148).toMatch(
      /UPDATE public\.cost_events ce\s+SET user_id = t\.user_id\s+FROM public\.threads t/s,
    );
    expect(migration0148).toContain("ce.thread_id = t.id");
    expect(migration0148).toContain("ce.tenant_id = t.tenant_id");
    expect(migration0148).toContain("ce.user_id IS NULL");
    expect(migration0148).toContain("t.user_id IS NOT NULL");
    expect(migration0148).not.toMatch(/FROM public\.users\s+u/i);
  });

  it("allows user budget scope in the database invariant", () => {
    expect(migration0148).toContain("scope IN ('tenant', 'agent', 'user')");
  });

  it("exposes user cost attribution fields in GraphQL source types", () => {
    expect(costTypes).toMatch(/type CostEvent[\s\S]*userId: ID/);
    expect(costTypes).toMatch(/type BudgetPolicy[\s\S]*userId: ID/);
    expect(costTypes).toMatch(/input UpsertBudgetPolicyInput[\s\S]*userId: ID/);
    expect(costTypes).toContain("type UserCostSummary");
    expect(costTypes).toMatch(
      /type UserCostSummary[\s\S]*isUnattributed: Boolean!/,
    );
    expect(subscriptionTypes).toMatch(
      /type CostRecordedEvent[\s\S]*userId: ID/,
    );
    expect(subscriptionTypes).toMatch(/notifyCostRecorded\([\s\S]*userId: ID/);
  });

  it("rolls back the user attribution columns and indexes", () => {
    for (const statement of [
      "DROP INDEX IF EXISTS public.idx_scheduled_jobs_budget_paused",
      "DROP INDEX IF EXISTS public.idx_budget_policies_user",
      "DROP INDEX IF EXISTS public.idx_cost_events_user_created",
      "DROP COLUMN IF EXISTS user_id",
      "DROP COLUMN IF EXISTS budget_paused",
    ]) {
      expect(rollback0148).toContain(statement);
    }
  });
});
