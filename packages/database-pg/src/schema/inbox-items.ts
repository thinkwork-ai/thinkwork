/**
 * Inbox item domain tables: inbox_items, inbox_item_comments,
 * inbox_item_links.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	integer,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

// ---------------------------------------------------------------------------
// 6.6 — inbox_items
// ---------------------------------------------------------------------------

export const inboxItems = pgTable(
	"inbox_items",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		requester_type: text("requester_type"),
		requester_id: uuid("requester_id"),
		recipient_id: uuid("recipient_id"),
		type: text("type").notNull(),
		status: text("status").notNull().default("pending"),
		title: text("title"),
		description: text("description"),
		entity_type: text("entity_type"),
		entity_id: uuid("entity_id"),
		config: jsonb("config"),
		revision: integer("revision").notNull().default(1),
		review_notes: text("review_notes"),
		decided_by: uuid("decided_by"),
		decided_at: timestamp("decided_at", { withTimezone: true }),
		expires_at: timestamp("expires_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_inbox_items_tenant_status").on(
			table.tenant_id,
			table.status,
		),
		index("idx_inbox_items_entity").on(table.entity_type, table.entity_id),
	],
);

// ---------------------------------------------------------------------------
// 6.7 — inbox_item_comments
// ---------------------------------------------------------------------------

export const inboxItemComments = pgTable("inbox_item_comments", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	inbox_item_id: uuid("inbox_item_id")
		.references(() => inboxItems.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	author_type: text("author_type"),
	author_id: uuid("author_id"),
	content: text("content").notNull(),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 6.8 — inbox_item_links
// ---------------------------------------------------------------------------

export const inboxItemLinks = pgTable("inbox_item_links", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	inbox_item_id: uuid("inbox_item_id")
		.references(() => inboxItems.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	linked_type: text("linked_type"),
	linked_id: uuid("linked_id"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const inboxItemsRelations = relations(inboxItems, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [inboxItems.tenant_id],
		references: [tenants.id],
	}),
	comments: many(inboxItemComments),
	links: many(inboxItemLinks),
}));

export const inboxItemCommentsRelations = relations(
	inboxItemComments,
	({ one }) => ({
		inboxItem: one(inboxItems, {
			fields: [inboxItemComments.inbox_item_id],
			references: [inboxItems.id],
		}),
		tenant: one(tenants, {
			fields: [inboxItemComments.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const inboxItemLinksRelations = relations(
	inboxItemLinks,
	({ one }) => ({
		inboxItem: one(inboxItems, {
			fields: [inboxItemLinks.inbox_item_id],
			references: [inboxItems.id],
		}),
		tenant: one(tenants, {
			fields: [inboxItemLinks.tenant_id],
			references: [tenants.id],
		}),
	}),
);
