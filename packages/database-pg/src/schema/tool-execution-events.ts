import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core";
import { threads } from "./threads";
import { threadTurns } from "./scheduled-jobs";

/**
 * Append-only ledger of Pi runtime tool executions (THINK-324 Wave-3 C17).
 * The runtime emits one `started` event when a tool call begins and at most
 * one terminal event (`completed`/`failed`/`uncertain`) when it ends, POSTed
 * to /api/runtime/tool-executions (the runtime cannot write Aurora directly).
 *
 * Succeeds the retired harness_tool_execution_events contract: same paired
 * started/terminal shape, but policy columns are nullable until per-call
 * re-authorization (C19) starts stamping decisions. Preview columns carry
 * only sanitized previews; credential material has no column in this
 * contract. Database triggers enforce start/terminal correlation and reject
 * mutation of existing evidence.
 */
export const toolExecutionEvents = pgTable(
  "tool_execution_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    thread_id: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    turn_id: uuid("turn_id")
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    principal_type: text("principal_type").notNull(),
    principal_id: text("principal_id").notNull(),
    tool_use_id: text("tool_use_id").notNull(),
    operation: text("operation").notNull(),
    policy_revision: text("policy_revision"),
    policy_decision_id: text("policy_decision_id"),
    idempotency_key: text("idempotency_key").notNull(),
    credential_owner_alias: text("credential_owner_alias"),
    event_type: text("event_type").notNull(),
    input_preview: jsonb("input_preview").$type<Record<string, unknown>>(),
    output_preview: jsonb("output_preview").$type<Record<string, unknown>>(),
    error_preview: jsonb("error_preview").$type<Record<string, unknown>>(),
    provider_request_id: text("provider_request_id"),
    duration_ms: integer("duration_ms"),
    provider_cost_usd: numeric("provider_cost_usd", {
      precision: 18,
      scale: 8,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tool_execution_started")
      .on(table.tenant_id, table.idempotency_key)
      .where(sql`${table.event_type} = 'started'`),
    uniqueIndex("uq_tool_execution_terminal")
      .on(table.tenant_id, table.idempotency_key)
      .where(sql`${table.event_type} IN ('completed','failed','uncertain')`),
    index("idx_tool_execution_turn").on(
      table.tenant_id,
      table.thread_id,
      table.turn_id,
      table.id,
    ),
    check(
      "tool_execution_principal_type_allowed",
      sql`${table.principal_type} IN ('user','service')`,
    ),
    check(
      "tool_execution_event_type_allowed",
      sql`${table.event_type} IN ('started','completed','failed','uncertain')`,
    ),
    check(
      "tool_execution_measurements_nonnegative",
      sql`(${table.duration_ms} IS NULL OR ${table.duration_ms} >= 0) AND (${table.provider_cost_usd} IS NULL OR ${table.provider_cost_usd} >= 0)`,
    ),
    check(
      "tool_execution_event_shape",
      sql`(${table.event_type} = 'started' AND ${table.input_preview} IS NOT NULL AND ${table.output_preview} IS NULL AND ${table.error_preview} IS NULL AND ${table.provider_request_id} IS NULL AND ${table.duration_ms} IS NULL AND ${table.provider_cost_usd} IS NULL) OR (${table.event_type} IN ('completed','failed','uncertain') AND ${table.input_preview} IS NULL)`,
    ),
  ],
);
