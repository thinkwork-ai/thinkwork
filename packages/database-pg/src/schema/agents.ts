/**
 * Agent domain tables: agents, capabilities, budget policies, skills,
 * model catalog, invites, join requests, API keys, permission grants.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	boolean,
	numeric,
	uniqueIndex,
	index,
	primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { agentKnowledgeBases } from "./knowledge-bases";
import { agentTemplates } from "./agent-templates.js";

// ---------------------------------------------------------------------------
// 1.1 — agents
// ---------------------------------------------------------------------------

export const agents = pgTable(
	"agents",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		slug: text("slug").unique(),
		role: text("role"),
		type: text("type").notNull().default("agent"),
		/** "user" = created by tenant admins, "system" = platform-managed (eval test agent, etc.) */
		source: text("source").notNull().default("user"),
		status: text("status").notNull().default("idle"),
		system_prompt: text("system_prompt"),
		reports_to: uuid("reports_to").references((): any => agents.id),
		/** Parent agent for sub-agent relationship. Sub-agents run in-process via Strands @tool. */
		parent_agent_id: uuid("parent_agent_id").references((): any => agents.id),
		human_pair_id: uuid("human_pair_id").references(() => users.id),
		adapter_type: text("adapter_type"),
		adapter_config: jsonb("adapter_config"),
		runtime_config: jsonb("runtime_config"),
		budget_monthly_cents: integer("budget_monthly_cents"),
		spent_monthly_cents: integer("spent_monthly_cents").default(0),
		budget_paused: boolean("budget_paused").notNull().default(false),
		budget_paused_at: timestamp("budget_paused_at", {
			withTimezone: true,
		}),
		budget_paused_reason: text("budget_paused_reason"),
		last_heartbeat_at: timestamp("last_heartbeat_at", {
			withTimezone: true,
		}),
		avatar_url: text("avatar_url"),
		/** Agent Template this agent belongs to (defines model, guardrail, tools, skills) */
		template_id: uuid("template_id")
			.references(() => agentTemplates.id)
			.notNull(),
		version: integer("version").notNull().default(1),
		/**
		 * Per-file content-hash pins for guardrail-class workspace files (GUARDRAILS.md,
		 * PLATFORM.md, CAPABILITIES.md). Shape: { "GUARDRAILS.md": "sha256:<hex>", ... }.
		 * Keys are the canonical file basenames; values are `sha256:<64-hex>` strings.
		 * Null until the agent goes through createAgentFromTemplate (Unit 8) or the
		 * one-shot migration (Unit 10). Template edits to pinned files surface as
		 * "Template update available" in the admin UI; operators accept updates via
		 * acceptTemplateUpdate / acceptTemplateUpdateBulk which advance the recorded hash.
		 */
		agent_pinned_versions: jsonb("agent_pinned_versions"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_agents_tenant_id").on(table.tenant_id),
		index("idx_agents_type").on(table.type),
		index("idx_agents_status").on(table.status),
		index("idx_agents_reports_to").on(table.reports_to),
		index("idx_agents_source").on(table.source),
	],
);

// ---------------------------------------------------------------------------
// 1.2 — agent_capabilities
// ---------------------------------------------------------------------------

export const agentCapabilities = pgTable(
	"agent_capabilities",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		capability: text("capability").notNull(),
		config: jsonb("config"),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_agent_capabilities_agent_capability").on(
			table.agent_id,
			table.capability,
		),
	],
);

// ---------------------------------------------------------------------------
// 1.4 — agent_skills
// ---------------------------------------------------------------------------

export const agentSkills = pgTable(
	"agent_skills",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		skill_id: text("skill_id").notNull(),
		config: jsonb("config"),
		permissions: jsonb("permissions"),
		rate_limit_rpm: integer("rate_limit_rpm"),
		/** Override the skill's default model for mode:agent skills */
		model_override: text("model_override"),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_agent_skills_agent_skill").on(
			table.agent_id,
			table.skill_id,
		),
	],
);

// ---------------------------------------------------------------------------
// 1.4b — agent_operation_leases
// ---------------------------------------------------------------------------

export const agentOperationLeases = pgTable(
	"agent_operation_leases",
	{
		agent_id: uuid("agent_id")
			.references(() => agents.id, { onDelete: "cascade" })
			.notNull(),
		lease_id: uuid("lease_id")
			.default(sql`gen_random_uuid()`)
			.notNull(),
		lease_kind: text("lease_kind").notNull(),
		owner_kind: text("owner_kind").notNull(),
		owner_id: text("owner_id"),
		acquired_at: timestamp("acquired_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		last_heartbeat_at: timestamp("last_heartbeat_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.agent_id, table.lease_id] }),
		index("idx_agent_operation_leases_agent_expires").on(
			table.agent_id,
			table.expires_at,
		),
		index("idx_agent_operation_leases_kind").on(
			table.agent_id,
			table.lease_kind,
		),
	],
);

export const folderBundleImportRateLimits = pgTable(
	"folder_bundle_import_rate_limits",
	{
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		utc_hour: timestamp("utc_hour", { withTimezone: true }).notNull(),
		import_count: integer("import_count").notNull().default(0),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		primaryKey({ columns: [table.tenant_id, table.utc_hour] }),
	],
);

// ---------------------------------------------------------------------------
// 1.5 — model_catalog
// ---------------------------------------------------------------------------

export const modelCatalog = pgTable("model_catalog", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	model_id: text("model_id").notNull().unique(),
	provider: text("provider").notNull(),
	display_name: text("display_name").notNull(),
	input_cost_per_million: numeric("input_cost_per_million", {
		precision: 10,
		scale: 4,
	}),
	output_cost_per_million: numeric("output_cost_per_million", {
		precision: 10,
		scale: 4,
	}),
	context_window: integer("context_window"),
	max_output_tokens: integer("max_output_tokens"),
	supports_vision: boolean("supports_vision").default(false),
	supports_tools: boolean("supports_tools").default(true),
	is_available: boolean("is_available").notNull().default(true),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 1.6 — invites
// ---------------------------------------------------------------------------

export const invites = pgTable("invites", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	token_hash: text("token_hash").notNull().unique(),
	invite_type: text("invite_type").notNull().default("agent"),
	allowed_join_types: text("allowed_join_types").array(),
	defaults_payload: jsonb("defaults_payload"),
	max_uses: integer("max_uses").notNull().default(5),
	used_count: integer("used_count").notNull().default(0),
	invited_by_user_id: uuid("invited_by_user_id").references(() => users.id),
	expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
	accepted_at: timestamp("accepted_at", { withTimezone: true }),
	revoked_at: timestamp("revoked_at", { withTimezone: true }),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 1.7 — join_requests
// ---------------------------------------------------------------------------

export const joinRequests = pgTable(
	"join_requests",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		invite_id: uuid("invite_id").references(() => invites.id),
		request_type: text("request_type").notNull().default("agent"),
		status: text("status").notNull().default("pending_approval"),
		agent_name: text("agent_name").notNull(),
		adapter_type: text("adapter_type").notNull(),
		capabilities: jsonb("capabilities").default(sql`'[]'::jsonb`),
		adapter_config: jsonb("adapter_config"),
		claim_secret_hash: text("claim_secret_hash"),
		claim_expires_at: timestamp("claim_expires_at", { withTimezone: true }),
		claim_consumed_at: timestamp("claim_consumed_at", { withTimezone: true }),
		created_agent_id: uuid("created_agent_id").references(() => agents.id),
		approved_by_user_id: uuid("approved_by_user_id").references(() => users.id),
		rejected_by_user_id: uuid("rejected_by_user_id").references(() => users.id),
		rejection_reason: text("rejection_reason"),
		resolved_at: timestamp("resolved_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_join_requests_tenant_status").on(table.tenant_id, table.status),
		index("join_requests_invite_idx").on(table.invite_id),
		index("join_requests_claim_secret_idx").on(table.claim_secret_hash),
	],
);

// ---------------------------------------------------------------------------
// 1.8 — agent_api_keys
// ---------------------------------------------------------------------------

export const agentApiKeys = pgTable("agent_api_keys", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	agent_id: uuid("agent_id")
		.references(() => agents.id)
		.notNull(),
	key_hash: text("key_hash").notNull().unique(),
	name: text("name"),
	last_used_at: timestamp("last_used_at", { withTimezone: true }),
	revoked_at: timestamp("revoked_at", { withTimezone: true }),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 1.9 — principal_permission_grants
// ---------------------------------------------------------------------------

export const principalPermissionGrants = pgTable(
	"principal_permission_grants",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		principal_type: text("principal_type").notNull(),
		principal_id: uuid("principal_id").notNull(),
		permission_key: text("permission_key").notNull(),
		scope: jsonb("scope"),
		granted_by: uuid("granted_by").references(() => users.id),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_ppg_principal").on(
			table.principal_type,
			table.principal_id,
		),
		uniqueIndex("uq_ppg_tenant_principal_permission").on(
			table.tenant_id,
			table.principal_type,
			table.principal_id,
			table.permission_key,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const agentsRelations = relations(agents, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [agents.tenant_id],
		references: [tenants.id],
	}),
	reportsTo: one(agents, {
		fields: [agents.reports_to],
		references: [agents.id],
		relationName: "agentHierarchy",
	}),
	subordinates: many(agents, {
		relationName: "agentHierarchy",
	}),
	parentAgent: one(agents, {
		fields: [agents.parent_agent_id],
		references: [agents.id],
		relationName: "subAgentRelation",
	}),
	subAgents: many(agents, {
		relationName: "subAgentRelation",
	}),
	humanPair: one(users, {
		fields: [agents.human_pair_id],
		references: [users.id],
	}),
	capabilities: many(agentCapabilities),
	skills: many(agentSkills),
	apiKeys: many(agentApiKeys),
	knowledgeBases: many(agentKnowledgeBases),
	agentTemplate: one(agentTemplates, {
		fields: [agents.template_id],
		references: [agentTemplates.id],
	}),
}));

export const agentCapabilitiesRelations = relations(
	agentCapabilities,
	({ one }) => ({
		agent: one(agents, {
			fields: [agentCapabilities.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [agentCapabilities.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const agentSkillsRelations = relations(
	agentSkills,
	({ one }) => ({
		agent: one(agents, {
			fields: [agentSkills.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [agentSkills.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const agentOperationLeasesRelations = relations(
	agentOperationLeases,
	({ one }) => ({
		agent: one(agents, {
			fields: [agentOperationLeases.agent_id],
			references: [agents.id],
		}),
	}),
);

export const folderBundleImportRateLimitsRelations = relations(
	folderBundleImportRateLimits,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [folderBundleImportRateLimits.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const invitesRelations = relations(invites, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [invites.tenant_id],
		references: [tenants.id],
	}),
	invitedBy: one(users, {
		fields: [invites.invited_by_user_id],
		references: [users.id],
	}),
	joinRequests: many(joinRequests),
}));

export const joinRequestsRelations = relations(joinRequests, ({ one }) => ({
	tenant: one(tenants, {
		fields: [joinRequests.tenant_id],
		references: [tenants.id],
	}),
	invite: one(invites, {
		fields: [joinRequests.invite_id],
		references: [invites.id],
	}),
	createdAgent: one(agents, {
		fields: [joinRequests.created_agent_id],
		references: [agents.id],
	}),
	approvedBy: one(users, {
		fields: [joinRequests.approved_by_user_id],
		references: [users.id],
		relationName: "approvedJoinRequests",
	}),
	rejectedBy: one(users, {
		fields: [joinRequests.rejected_by_user_id],
		references: [users.id],
		relationName: "rejectedJoinRequests",
	}),
}));

export const agentApiKeysRelations = relations(
	agentApiKeys,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [agentApiKeys.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [agentApiKeys.agent_id],
			references: [agents.id],
		}),
	}),
);

export const principalPermissionGrantsRelations = relations(
	principalPermissionGrants,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [principalPermissionGrants.tenant_id],
			references: [tenants.id],
		}),
		grantedBy: one(users, {
			fields: [principalPermissionGrants.granted_by],
			references: [users.id],
		}),
	}),
);
