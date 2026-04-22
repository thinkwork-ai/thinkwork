/**
 * sandbox_invocations — per-call audit row for AgentCore Code Interpreter
 * sandbox usage. One row per executeCode call; joinable to skill_runs by
 * nullable run_id (sandbox can fire outside a composition).
 *
 * Metadata only — stdout/stderr content goes to CloudWatch. executed_code_hash
 * is SHA-256 of user code (preamble excluded) so dedup/repeat-pattern analysis
 * is possible without retaining code text.
 *
 * Retention: delete_at defaults now() + 30d, capped at 180d by the retention
 * ceiling CHECK — mirrors skill_runs.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { skillRuns } from "./skill-runs";

export const SANDBOX_INVOCATION_EXIT_STATUSES = [
  "ok",
  "error",
  "timeout",
  "oom",
  "cap_exceeded",
  "provisioning",
  "connection_revoked",
] as const;
export type SandboxInvocationExitStatus =
  (typeof SANDBOX_INVOCATION_EXIT_STATUSES)[number];

// Matches the three interactive/scheduled entry points that dispatch the
// Strands runtime today. Extend this list if a new caller lands.
export const SANDBOX_INVOCATION_SOURCES = [
  "chat",
  "scheduled",
  "composition",
] as const;
export type SandboxInvocationSource =
  (typeof SANDBOX_INVOCATION_SOURCES)[number];

export const SANDBOX_INVOCATION_MAX_RETENTION_DAYS = 180;
export const SANDBOX_INVOCATION_DEFAULT_RETENTION_DAYS = 30;

export const sandboxInvocations = pgTable(
  "sandbox_invocations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    // Nullable: ad-hoc (non-composition) invocations have no skill_runs row.
    run_id: uuid("run_id").references(() => skillRuns.id),
    agent_id: uuid("agent_id").references(() => agents.id),
    user_id: uuid("user_id").notNull(),
    template_id: text("template_id"),
    tool_call_id: text("tool_call_id"),
    session_id: text("session_id"),
    environment_id: text("environment_id").notNull(),
    invocation_source: text("invocation_source"),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    duration_ms: integer("duration_ms"),
    exit_status: text("exit_status"),
    // Raw pre-truncation byte counts. The actual stream content lives in
    // CloudWatch; these let the admin UI show "stdout was 512KB, truncated
    // to 256KB in the agent response."
    stdout_bytes: bigint("stdout_bytes", { mode: "number" }),
    stderr_bytes: bigint("stderr_bytes", { mode: "number" }),
    stdout_truncated: boolean("stdout_truncated").notNull().default(false),
    stderr_truncated: boolean("stderr_truncated").notNull().default(false),
    peak_memory_mb: integer("peak_memory_mb"),
    // Parsed from AgentCore APPLICATION_LOGS when discoverable; best-effort.
    outbound_hosts: jsonb("outbound_hosts"),
    // SHA-256 of user code (not preamble, not tokens). Dedup + repeat-pattern
    // analysis without retaining code text.
    executed_code_hash: text("executed_code_hash"),
    failure_reason: text("failure_reason"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    delete_at: timestamp("delete_at", { withTimezone: true })
      .notNull()
      .default(
        sql`now() + interval '${sql.raw(
          String(SANDBOX_INVOCATION_DEFAULT_RETENTION_DAYS),
        )} days'`,
      ),
  },
  (table) => [
    index("idx_sandbox_invocations_tenant_started").on(
      table.tenant_id,
      table.started_at,
    ),
    index("idx_sandbox_invocations_tenant_agent_started").on(
      table.tenant_id,
      table.agent_id,
      table.started_at,
    ),
    index("idx_sandbox_invocations_user").on(table.user_id),
    index("idx_sandbox_invocations_run").on(table.run_id),
    index("idx_sandbox_invocations_delete_at").on(table.delete_at),
    check(
      "sandbox_invocations_retention_ceiling",
      sql`${table.delete_at} <= ${table.started_at} + interval '${sql.raw(String(SANDBOX_INVOCATION_MAX_RETENTION_DAYS))} days'`,
    ),
    check(
      "sandbox_invocations_exit_status_allowed",
      sql`${table.exit_status} IS NULL OR ${table.exit_status} IN ('ok','error','timeout','oom','cap_exceeded','provisioning','connection_revoked')`,
    ),
    check(
      "sandbox_invocations_source_allowed",
      sql`${table.invocation_source} IS NULL OR ${table.invocation_source} IN ('chat','scheduled','composition')`,
    ),
  ],
);

export const sandboxInvocationsRelations = relations(
  sandboxInvocations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [sandboxInvocations.tenant_id],
      references: [tenants.id],
    }),
    agent: one(agents, {
      fields: [sandboxInvocations.agent_id],
      references: [agents.id],
    }),
    run: one(skillRuns, {
      fields: [sandboxInvocations.run_id],
      references: [skillRuns.id],
    }),
  }),
);
