/**
 * MCP Server tables: tenant_mcp_servers, agent_mcp_servers.
 *
 * MCP servers are registered at the tenant level (shared catalog), then
 * assigned to agent templates and synced to individual agents.
 *
 * Auth patterns:
 *   - 'none': no auth headers
 *   - 'tenant_api_key': shared API key stored in Secrets Manager (via auth_config.secretRef)
 *   - 'per_user_oauth': per-user OAuth via existing connections table (oauth_provider links to connect_providers)
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
import { agents } from "./agents.js";

// ---------------------------------------------------------------------------
// tenant_mcp_servers — tenant-level registry of available MCP servers
// ---------------------------------------------------------------------------

export const tenantMcpServers = pgTable(
	"tenant_mcp_servers",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		/** Display name */
		name: text("name").notNull(),
		/** URL-safe identifier (unique per tenant) */
		slug: text("slug").notNull(),
		/** MCP endpoint URL */
		url: text("url").notNull(),
		/** Transport type: 'streamable-http' | 'sse' */
		transport: text("transport").notNull().default("streamable-http"),
		/** Auth pattern: 'none' | 'tenant_api_key' | 'per_user_oauth' */
		auth_type: text("auth_type").notNull().default("none"),
		/** For tenant_api_key: { secretRef: "arn:..." }. For other types: null */
		auth_config: jsonb("auth_config"),
		/** For per_user_oauth: provider name (e.g., "lastmile") matching connect_providers.name */
		oauth_provider: text("oauth_provider"),
		/** Cached tool list from discovery: [{ name: string, description?: string }] */
		tools: jsonb("tools"),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_mcp_servers_slug").on(table.tenant_id, table.slug),
		index("idx_tenant_mcp_servers_tenant").on(table.tenant_id),
	],
);

// ---------------------------------------------------------------------------
// agent_mcp_servers — per-agent MCP enablement (synced from template)
// ---------------------------------------------------------------------------

export const agentMcpServers = pgTable(
	"agent_mcp_servers",
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
		mcp_server_id: uuid("mcp_server_id")
			.references(() => tenantMcpServers.id)
			.notNull(),
		enabled: boolean("enabled").notNull().default(true),
		/** Agent-level overrides: { toolAllowlist?: string[], ... } */
		config: jsonb("config"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_agent_mcp_servers").on(table.agent_id, table.mcp_server_id),
		index("idx_agent_mcp_servers_agent").on(table.agent_id),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const tenantMcpServersRelations = relations(
	tenantMcpServers,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [tenantMcpServers.tenant_id],
			references: [tenants.id],
		}),
		agentAssignments: many(agentMcpServers),
	}),
);

export const agentMcpServersRelations = relations(
	agentMcpServers,
	({ one }) => ({
		agent: one(agents, {
			fields: [agentMcpServers.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [agentMcpServers.tenant_id],
			references: [tenants.id],
		}),
		mcpServer: one(tenantMcpServers, {
			fields: [agentMcpServers.mcp_server_id],
			references: [tenantMcpServers.id],
		}),
	}),
);
