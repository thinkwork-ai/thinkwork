/**
 * Email Channel domain tables: email_reply_tokens.
 * Supports agent-owned email via SES with cryptographic reply tokens (PRD-14).
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// email_reply_tokens
// ---------------------------------------------------------------------------

export const emailReplyTokens = pgTable(
	"email_reply_tokens",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		token_hash: text("token_hash").notNull().unique(),
		context_type: text("context_type").notNull(),
		context_id: uuid("context_id").notNull(),
		recipient_email: text("recipient_email").notNull(),
		ses_message_id: text("ses_message_id"),
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumed_at: timestamp("consumed_at", { withTimezone: true }),
		max_uses: integer("max_uses").notNull().default(3),
		use_count: integer("use_count").notNull().default(0),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_email_reply_tokens_hash").on(table.token_hash),
		index("idx_email_reply_tokens_agent").on(table.agent_id),
		index("idx_email_reply_tokens_expires").on(
			table.tenant_id,
			table.expires_at,
		),
		index("idx_email_reply_tokens_ses_msg").on(table.ses_message_id),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const emailReplyTokensRelations = relations(
	emailReplyTokens,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [emailReplyTokens.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [emailReplyTokens.agent_id],
			references: [agents.id],
		}),
	}),
);
