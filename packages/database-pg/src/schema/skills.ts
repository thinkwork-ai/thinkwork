/**
 * Skill Catalog domain tables: skill_catalog, tenant_skills.
 * PRD-31: Skills Catalog Upgrade
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	boolean,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";

// ---------------------------------------------------------------------------
// skill_catalog — canonical catalog metadata (replaces S3 index.json)
// ---------------------------------------------------------------------------

export const skillCatalog = pgTable(
	"skill_catalog",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		slug: text("slug").notNull().unique(),
		/** Human-readable display name (from skill.yaml display_name) */
		display_name: text("display_name").notNull(),
		description: text("description"),
		category: text("category"),
		version: text("version").notNull(),
		author: text("author").notNull().default("thinkwork"),
		icon: text("icon"),
		tags: text("tags").array(),
		/** 'builtin' | 'community' */
		source: text("source").notNull().default("builtin"),
		/** Auto-install for all tenants */
		is_default: boolean("is_default").notNull().default(false),
		/** 'script' | 'mcp' | 'context' */
		execution: text("execution").notNull().default("context"),
		/** PRD-38: 'tool' (direct parent tools) | 'agent' (sub-agent with own reasoning loop) */
		mode: text("mode").notNull().default("tool"),
		requires_env: text("requires_env").array(),
		oauth_provider: text("oauth_provider"),
		oauth_scopes: text("oauth_scopes").array(),
		/** Linked MCP server name (transitional — migrates to script) */
		mcp_server: text("mcp_server"),
		mcp_tools: text("mcp_tools").array(),
		/** Skill slugs this skill depends on */
		dependencies: text("dependencies").array(),
		/** Trigger phrases for progressive disclosure tier-1 matching */
		triggers: text("triggers").array(),
		/** Cached YAML frontmatter for fast tier-1 loading */
		tier1_metadata: jsonb("tier1_metadata"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_skill_catalog_category").on(table.category),
		index("idx_skill_catalog_execution").on(table.execution),
	],
);

// ---------------------------------------------------------------------------
// tenant_skills — tracks which skills each tenant has installed
// ---------------------------------------------------------------------------

export const tenantSkills = pgTable(
	"tenant_skills",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		/** Skill slug from skill.yaml */
		skill_id: text("skill_id").notNull(),
		/** 'builtin' | 'catalog' | 'tenant' */
		source: text("source").notNull().default("catalog"),
		/** Installed version */
		version: text("version"),
		/** Version from catalog at time of install */
		catalog_version: text("catalog_version"),
		config: jsonb("config"),
		enabled: boolean("enabled").notNull().default(true),
		installed_at: timestamp("installed_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_skills").on(table.tenant_id, table.skill_id),
		index("idx_tenant_skills_tenant_source").on(table.tenant_id, table.source),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const tenantSkillsRelations = relations(tenantSkills, ({ one }) => ({
	tenant: one(tenants, {
		fields: [tenantSkills.tenant_id],
		references: [tenants.id],
	}),
}));
