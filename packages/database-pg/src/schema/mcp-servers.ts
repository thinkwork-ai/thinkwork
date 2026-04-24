/**
 * MCP Server tables: tenant_mcp_servers, agent_mcp_servers.
 *
 * MCP servers are registered at the tenant level (shared catalog), then
 * assigned to agent templates and synced to individual agents.
 *
 * Auth patterns:
 *   - 'none': no auth headers
 *   - 'tenant_api_key': shared API key stored in Secrets Manager (via auth_config.secretRef)
 *   - 'oauth': server-managed OAuth per RFC 9728; the MCP server advertises its own
 *     auth requirements via /.well-known/oauth-protected-resource. Per-user tokens
 *     stored in user_mcp_tokens after the user completes the OAuth flow.
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
    /** Auth pattern: 'none' | 'tenant_api_key' | 'oauth' */
    auth_type: text("auth_type").notNull().default("none"),
    /** For tenant_api_key: { secretRef: "arn:..." }. For other types: null */
    auth_config: jsonb("auth_config"),
    /** @deprecated — use RFC 9728 discovery instead. Kept for migration compat. */
    oauth_provider: text("oauth_provider"),
    /** Cached tool list from discovery: [{ name: string, description?: string }] */
    tools: jsonb("tools"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Admin-approval gate for MCP endpoints shipped inside uploaded plugins
     * (plan #007 §R8). 'pending' blocks invocation; 'approved' unlocks it;
     * 'rejected' is terminal. CHECK-constrained in migration 0025 to the
     * three-value domain. Existing rows default to 'approved' so this
     * column cannot accidentally revoke working integrations during rollout.
     */
    status: text("status").notNull().default("approved"),
    /**
     * sha256 of (url, auth_config) captured at approve time. Any mutation
     * to `url` or `auth_config` on an `approved` row reverts status to
     * 'pending' and clears approval metadata (invariant SI-5, enforced in
     * the API resolver landing in U11).
     */
    url_hash: text("url_hash"),
    /** Admin user who approved the server (FK to users, nullable until first approval). */
    approved_by: uuid("approved_by"),
    /** When the server transitioned to 'approved'. Null for pending/rejected. */
    approved_at: timestamp("approved_at", { withTimezone: true }),
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
// agent_template_mcp_servers — template-level MCP assignment (replaces JSONB)
// ---------------------------------------------------------------------------

export const agentTemplateMcpServers = pgTable(
  "agent_template_mcp_servers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    template_id: uuid("template_id").notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    mcp_server_id: uuid("mcp_server_id")
      .references(() => tenantMcpServers.id)
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_template_mcp_servers").on(
      table.template_id,
      table.mcp_server_id,
    ),
    index("idx_agent_template_mcp_servers_template").on(table.template_id),
  ],
);

// ---------------------------------------------------------------------------
// user_mcp_tokens — per-user OAuth tokens from MCP server auth flows
// ---------------------------------------------------------------------------

export const userMcpTokens = pgTable(
  "user_mcp_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    mcp_server_id: uuid("mcp_server_id")
      .references(() => tenantMcpServers.id)
      .notNull(),
    /** Secrets Manager ARN: thinkwork/{stage}/mcp-tokens/{userId}/{mcpServerId} */
    secret_ref: text("secret_ref").notNull(),
    /** When the access token expires */
    expires_at: timestamp("expires_at", { withTimezone: true }),
    /** Status: 'active' | 'expired' | 'revoked' */
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_user_mcp_tokens").on(table.user_id, table.mcp_server_id),
    index("idx_user_mcp_tokens_user").on(table.user_id),
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

export const agentTemplateMcpServersRelations = relations(
  agentTemplateMcpServers,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [agentTemplateMcpServers.tenant_id],
      references: [tenants.id],
    }),
    mcpServer: one(tenantMcpServers, {
      fields: [agentTemplateMcpServers.mcp_server_id],
      references: [tenantMcpServers.id],
    }),
  }),
);

export const userMcpTokensRelations = relations(userMcpTokens, ({ one }) => ({
  tenant: one(tenants, {
    fields: [userMcpTokens.tenant_id],
    references: [tenants.id],
  }),
  mcpServer: one(tenantMcpServers, {
    fields: [userMcpTokens.mcp_server_id],
    references: [tenantMcpServers.id],
  }),
}));
