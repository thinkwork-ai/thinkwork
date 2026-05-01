/**
 * Routine approval tokens domain table: routine_approval_tokens.
 *
 * HITL substrate for the inbox_approval recipe. Step Functions Task
 * with .waitForTaskToken pauses execution and emits a task token; the
 * routine-approval-callback Lambda persists that token in this table
 * keyed on the inbox_items row that surfaces the decision to the
 * operator.
 *
 * Consume-once invariant: a partial UNIQUE index on (execution_id,
 * node_id) WHERE consumed=false ensures only one pending decision per
 * execution+node. The decideRoutineApproval mutation does a conditional
 * UPDATE (consumed=false → true) atomically before calling
 * SendTaskSuccess/SendTaskFailure to prevent double-decide races.
 *
 * Plan: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md (U2).
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	integer,
	boolean,
	index,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { routineExecutions } from "./routine-executions";
import { inboxItems } from "./inbox-items";

export const routineApprovalTokens = pgTable(
	"routine_approval_tokens",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		execution_id: uuid("execution_id")
			.references(() => routineExecutions.id)
			.notNull(),
		// One inbox item per pending approval. Unique so the bridge can
		// look up by inbox_item_id without ambiguity.
		inbox_item_id: uuid("inbox_item_id")
			.references(() => inboxItems.id)
			.notNull(),
		// ASL state name where this approval was requested.
		node_id: text("node_id").notNull(),
		// The Step Functions task token, opaque ~1KB string. Carried
		// to SendTaskSuccess / SendTaskFailure on resume.
		task_token: text("task_token").notNull(),
		// Optional heartbeat. When set, the bridge emits SendTaskHeartbeat
		// from a periodic EventBridge rule so a stalled bridge surfaces
		// as TaskTimedOut rather than a silent hang.
		heartbeat_seconds: integer("heartbeat_seconds"),
		// Consume-once flag. Conditional UPDATE (consumed=false → true)
		// enforces single-decision idempotency; second decide on the same
		// token returns alreadyDecided=true.
		consumed: boolean("consumed").notNull().default(false),
		decided_by_user_id: uuid("decided_by_user_id"),
		decision_value_json: jsonb("decision_value_json"),
		decided_at: timestamp("decided_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		// SFN tokens live up to the execution's 1-year quota; expires_at
		// captures that boundary so the deferred reaper job can flag tokens
		// whose execution has ended.
		expires_at: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => [
		// Inbox item is a candidate key; bridge resolver looks up by it.
		uniqueIndex("idx_routine_approval_tokens_inbox").on(table.inbox_item_id),
		// One pending decision per (execution, node) at any time. Partial
		// unique index (only when consumed=false) preserves history of
		// past decisions while preventing concurrent ones.
		uniqueIndex("idx_routine_approval_tokens_pending")
			.on(table.execution_id, table.node_id)
			.where(sql`${table.consumed} = false`),
		index("idx_routine_approval_tokens_tenant_consumed").on(
			table.tenant_id,
			table.consumed,
		),
	],
);

export const routineApprovalTokensRelations = relations(
	routineApprovalTokens,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [routineApprovalTokens.tenant_id],
			references: [tenants.id],
		}),
		execution: one(routineExecutions, {
			fields: [routineApprovalTokens.execution_id],
			references: [routineExecutions.id],
		}),
		inboxItem: one(inboxItems, {
			fields: [routineApprovalTokens.inbox_item_id],
			references: [inboxItems.id],
		}),
	}),
);
