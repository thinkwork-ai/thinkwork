/**
 * Step Functions task-token store for the shared workflow interpreter
 * (THINK-219). Tokens are persisted here at step dispatch time and consumed
 * exactly once via CAS on status — they never travel in wakeup payloads,
 * run events, or evidence (redaction-safe by construction).
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { tenants } from "./core";
import { workflowRuns } from "./workflow-runs";

export const WORKFLOW_TASK_TOKEN_PURPOSES = [
  "agent_step",
  "approval",
  "memory_stage",
] as const;
export const WORKFLOW_TASK_TOKEN_STATUSES = [
  "pending",
  "consumed",
  "expired",
] as const;

export const workflowTaskTokens = pgTable(
  "workflow_task_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_run_id: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    step_id: text("step_id").notNull(),
    iteration: integer("iteration").notNull().default(1),
    purpose: text("purpose").notNull(),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("workflow_task_tokens_step_uidx").on(
      table.workflow_run_id,
      table.step_id,
      table.iteration,
      table.purpose,
    ),
    index("workflow_task_tokens_tenant_idx").on(table.tenant_id),
    check(
      "workflow_task_tokens_purpose_check",
      sql`${table.purpose} IN ('agent_step', 'approval', 'memory_stage')`,
    ),
    check(
      "workflow_task_tokens_status_check",
      sql`${table.status} IN ('pending', 'consumed', 'expired')`,
    ),
  ],
);
