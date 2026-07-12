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
  jsonb,
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
/**
 * Lifecycle: pending -> executing (durable pre-execution claim, F1) ->
 * consumed (result persisted, F9). `executing` rows with a stale locked_at
 * may be re-claimed so a crashed worker's retry or continuation can proceed
 * (F7 lease). Consumed/executing rows are monotonic — storeTaskToken never
 * resurrects them.
 */
export const WORKFLOW_TASK_TOKEN_STATUSES = [
  "pending",
  "executing",
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
    /** Set when a worker claims the token (status executing); a claim with a
     * stale locked_at (> lease window) may be taken over. */
    locked_at: timestamp("locked_at", { withTimezone: true }),
    /** Identity of the claiming worker (aws request id or random id). */
    locked_by: text("locked_by"),
    /** Persisted completion result — enables safe redrive when
     * SendTaskSuccess failed after the token was consumed (F9). */
    result: jsonb("result"),
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
      "workflow_task_tokens_purpose_check_v2",
      sql`${table.purpose} IN ('agent_step', 'approval', 'memory_stage')`,
    ),
    check(
      "workflow_task_tokens_status_check_v2",
      sql`${table.status} IN ('pending', 'executing', 'consumed', 'expired')`,
    ),
  ],
);
