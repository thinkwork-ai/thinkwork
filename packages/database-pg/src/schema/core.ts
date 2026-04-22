/**
 * Core domain tables: tenants, users, user_profiles, tenant_settings, tenant_members.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	boolean,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 0.4 — tenants
// ---------------------------------------------------------------------------

export const tenants = pgTable("tenants", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	plan: text("plan").notNull().default("pro"),
	issue_prefix: text("issue_prefix"),
	issue_counter: integer("issue_counter").notNull().default(0),
	channel_counters: jsonb("channel_counters").notNull().default({}),
	// Compounding-memory feature gate. Off for every tenant at migration time;
	// flipped on per tenant as the wiki-compile pipeline is rolled out. Checked
	// by the memory-retain → wiki-compile enqueue path.
	wiki_compile_enabled: boolean("wiki_compile_enabled")
		.notNull()
		.default(false),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 0.5 — users
// ---------------------------------------------------------------------------

export const users = pgTable(
	"users",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id").references(() => tenants.id),
		email: text("email").unique(),
		name: text("name"),
		image: text("image"),
		email_verified_at: timestamp("email_verified_at", {
			withTimezone: true,
		}),
		phone: text("phone"),
		phone_verified_at: timestamp("phone_verified_at", {
			withTimezone: true,
		}),
		expo_push_token: text("expo_push_token"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("idx_users_email").on(table.email),
		index("idx_users_tenant_id").on(table.tenant_id),
	],
);

// ---------------------------------------------------------------------------
// 0.6 — user_profiles
// ---------------------------------------------------------------------------

export const userProfiles = pgTable("user_profiles", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	user_id: uuid("user_id")
		.references(() => users.id)
		.unique(),
	tenant_id: uuid("tenant_id").references(() => tenants.id),
	display_name: text("display_name"),
	theme: text("theme").default("system"),
	notification_preferences: jsonb("notification_preferences"),
	/**
	 * Profession / role label (e.g., "Founder", "VP Engineering"). Rendered into
	 * agent USER.md as {{HUMAN_TITLE}} at assignment time. Null → renders as "—".
	 */
	title: text("title"),
	/**
	 * IANA timezone identifier (e.g., "America/Chicago"). Rendered into agent
	 * USER.md as {{HUMAN_TIMEZONE}} at assignment time. Null → renders as "—".
	 */
	timezone: text("timezone"),
	/**
	 * Preferred pronouns (free text, e.g., "he/him", "they/them"). Rendered into
	 * agent USER.md as {{HUMAN_PRONOUNS}} at assignment time. Null → renders as "—".
	 */
	pronouns: text("pronouns"),
	/**
	 * Short/preferred name — what the agent should call this human in chat
	 * ("Eric" vs the full "Eric Odom"). Maintained by the agent via the
	 * `update_user_profile` tool when the human says "just call me X".
	 * Rendered into USER.md as {{HUMAN_CALL_BY}}. Null → renders as "—".
	 */
	call_by: text("call_by"),
	/**
	 * Free-form notes the agent maintains about the human — communication
	 * preferences, working style, context. Rendered into USER.md as
	 * {{HUMAN_NOTES}}. Null → renders as "—".
	 *
	 * Phone number for USER.md's {{HUMAN_PHONE}} is read from `users.phone`
	 * — that column already exists for account-level contact info. No
	 * separate profile column.
	 */
	notes: text("notes"),
	/**
	 * Free-form markdown describing the human's family / close contacts.
	 * Rendered under USER.md's `## Family` section as {{HUMAN_FAMILY}}.
	 * Null → renders as "—".
	 */
	family: text("family"),
	/**
	 * Free-form markdown capturing ongoing context about the human — projects,
	 * recurring topics, situational color. Rendered under USER.md's
	 * `## Context` section as {{HUMAN_CONTEXT}}. Null → renders as "—".
	 */
	context: text("context"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 0.7 — tenant_settings
// ---------------------------------------------------------------------------

export const tenantSettings = pgTable("tenant_settings", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.unique(),
	default_model: text("default_model"),
	budget_monthly_cents: integer("budget_monthly_cents"),
	auto_close_thread_minutes: integer("auto_close_thread_minutes").default(30),
	max_agents: integer("max_agents"),
	features: jsonb("features"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 0.8 — tenant_members (Paperclip pattern)
// ---------------------------------------------------------------------------

export const tenantMembers = pgTable(
	"tenant_members",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		principal_type: text("principal_type").notNull(),
		principal_id: uuid("principal_id").notNull(),
		role: text("role").notNull().default("member"),
		status: text("status").notNull().default("active"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_tenant_members_tenant").on(table.tenant_id),
		index("idx_tenant_members_principal").on(
			table.principal_type,
			table.principal_id,
		),
		uniqueIndex("uq_tenant_members_principal").on(
			table.tenant_id,
			table.principal_type,
			table.principal_id,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
	users: many(users),
	settings: one(tenantSettings),
	members: many(tenantMembers),
}));

export const usersRelations = relations(users, ({ one }) => ({
	tenant: one(tenants, {
		fields: [users.tenant_id],
		references: [tenants.id],
	}),
	profile: one(userProfiles),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
	user: one(users, {
		fields: [userProfiles.user_id],
		references: [users.id],
	}),
	tenant: one(tenants, {
		fields: [userProfiles.tenant_id],
		references: [tenants.id],
	}),
}));

export const tenantSettingsRelations = relations(
	tenantSettings,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantSettings.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
	tenant: one(tenants, {
		fields: [tenantMembers.tenant_id],
		references: [tenants.id],
	}),
}));
