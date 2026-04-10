/**
 * Workflow configuration tables — per-tenant and per-team orchestration settings.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";
import { teams } from "./teams";

export const workflowConfigs = pgTable(
	"workflow_configs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		team_id: uuid("team_id").references(() => teams.id),
		dispatch: jsonb("dispatch"),
		concurrency: jsonb("concurrency"),
		retry: jsonb("retry"),
		turn_loop: jsonb("turn_loop"),
		workspace: jsonb("workspace"),
		stall_detection: jsonb("stall_detection"),
		orchestration: jsonb("orchestration"),
		session_compaction: jsonb("session_compaction"),
		prompt_template: text("prompt_template"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(t) => [
		index("workflow_configs_tenant_idx").on(t.tenant_id),
		index("workflow_configs_tenant_team_idx").on(t.tenant_id, t.team_id),
	],
);
