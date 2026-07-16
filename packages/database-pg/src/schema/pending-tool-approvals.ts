/**
 * Pending tool approvals — parked-turn HITL (THINK-302 U11 — R12/R27/R32/R33).
 *
 * A distinct pending kind from `pending_user_questions` (KTD-5): a gated
 * tool call parks the turn and this row is the recoverable ledger. Its own
 * partial unique index (one `pending` approval per thread) means an
 * approval can coexist with a pending question — the two never share a slot,
 * and the reply route never touches this table (R27).
 *
 * Data-minimization contract (KTD-5): the row holds (a) a minimized
 * **execution payload** — exactly what resume needs (tool name, call id,
 * arguments) — encrypted at the application layer with a platform key, and
 * (b) a separately generated, size-bounded, **redacted display summary**
 * used by the card, Slack, logs, and the governance feed. Raw arguments
 * never appear in logs/Slack/governance. The execution payload is purged
 * (`payload_purged_at` set, `encrypted_payload` nulled) at terminal state,
 * and a reaper redacts any terminal row older than a maximum age.
 *
 * The row is keyed for idempotent resume replay by (thread, turn, tool call
 * id, manifest fingerprint) — a stale approval cannot authorize a drifted
 * definition. `requesting_user_id` is the parked turn's server-resolved
 * calling user (the `once`-gate subject, R33); `approved_by` is the resolver,
 * recorded separately so an operator approving on a user's behalf unlocks
 * `once` for that user only.
 *
 * The partial unique index (one `pending` per thread) and the resume-replay
 * uniqueness live in the hand-rolled migration
 * drizzle/0258_pending_tool_approvals.sql — drizzle-kit cannot express a
 * partial index, so `db:push` will not create them.
 *
 * Ships INERT in U11a: no intake/consume/mutation writes to this table yet
 * (U11b wires them); U12 consumes it at the runtime gate.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { threads } from "./threads";
import { messages } from "./messages";
import { threadTurns } from "./scheduled-jobs";

// ---------------------------------------------------------------------------
// pending_tool_approvals — parked gated-call ledger + resolution state
// ---------------------------------------------------------------------------

export const pendingToolApprovals = pgTable(
  "pending_tool_approvals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    // The parked turn (finalizes; AWAITING_APPROVAL derives from a pending row).
    thread_turn_id: uuid("thread_turn_id")
      .references(() => threadTurns.id)
      .notNull(),
    // The assistant message carrying the approval card, written with this row.
    message_id: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    // Resume-replay identity (KTD-5): a stale approval cannot authorize a
    // drifted definition. `tool_call_id` is the parked assistant tool_use id;
    // a batch of gated calls from one assistant message shares one row keyed
    // by the FIRST call id, with the rest carried in the execution payload.
    manifest_fingerprint: text("manifest_fingerprint").notNull(),
    tool_call_id: text("tool_call_id").notNull(),
    // The gated capability (for the `once` key + governance/audit).
    class: text("class").notNull(),
    slug: text("slug").notNull(),
    marker_sha: text("marker_sha").notNull(),
    status: text("status").notNull().default("pending"),
    // The `once`-gate subject: the parked turn's server-resolved calling user
    // (R33). Null for a run-as/wakeup turn with no run-as user.
    requesting_user_id: uuid("requesting_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Encrypted minimized execution payload (tool name, call id, arguments) —
    // app-layer encrypted with a platform key; nulled on terminal purge.
    encrypted_payload: text("encrypted_payload"),
    // Redacted, size-bounded display summary for card/Slack/logs/governance.
    // NEVER holds raw argument values.
    display_summary: jsonb("display_summary").notNull(),
    // Resolution provenance — the resolver, distinct from requesting_user_id.
    approved_by: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // How it resolved: 'card' | 'slack' | 'governance' | 'archive' | 'reaper'.
    answered_via: text("answered_via"),
    answered_at: timestamp("answered_at", { withTimezone: true }),
    // When the execution payload was purged (terminal state or reaper).
    payload_purged_at: timestamp("payload_purged_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_pending_tool_approvals_tenant").on(table.tenant_id),
    index("idx_pending_tool_approvals_thread_status").on(
      table.thread_id,
      table.status,
    ),
    index("idx_pending_tool_approvals_message").on(table.message_id),
    // Reaper scan: terminal rows with a payload still present, by age.
    index("idx_pending_tool_approvals_purge").on(
      table.status,
      table.payload_purged_at,
    ),
    check(
      "pending_tool_approvals_status_allowed",
      sql`${table.status} IN ('pending','approved','denied','cancelled')`,
    ),
    check(
      "pending_tool_approvals_answered_via_allowed",
      sql`${table.answered_via} IS NULL OR ${table.answered_via} IN ('card','slack','governance','archive','reaper')`,
    ),
    // A resolved row must carry its resolution timestamp; a pending row must not.
    check(
      "pending_tool_approvals_terminal_consistency",
      sql`(${table.status} = 'pending') = (${table.answered_at} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const pendingToolApprovalsRelations = relations(
  pendingToolApprovals,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [pendingToolApprovals.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [pendingToolApprovals.thread_id],
      references: [threads.id],
    }),
    threadTurn: one(threadTurns, {
      fields: [pendingToolApprovals.thread_turn_id],
      references: [threadTurns.id],
    }),
    message: one(messages, {
      fields: [pendingToolApprovals.message_id],
      references: [messages.id],
    }),
    requestingUser: one(users, {
      fields: [pendingToolApprovals.requesting_user_id],
      references: [users.id],
    }),
  }),
);
