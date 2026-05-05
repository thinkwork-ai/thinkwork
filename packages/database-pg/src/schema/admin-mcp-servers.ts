/**
 * Admin MCP server registry — separate from `tenant_mcp_servers` so that
 * admin-class capabilities (the ThinkWork admin-ops control plane) cannot
 * be attached to a non-admin agent template via the regular tenant-MCP
 * admin UI.
 *
 * The structural separation is the boundary: the tenant-MCP attach handler
 * physically cannot return admin servers because they live in a different
 * table. Compare to permission-boundary IAM patterns — a layer that no
 * resource policy can override.
 *
 * Plan: docs/plans/2026-05-05-001-refactor-admin-ops-mcp-separation-plan.md
 *
 * Shape mirrors `tenant_mcp_servers` and its joins (`agent_mcp_servers`,
 * `agent_template_mcp_servers`) so the runtime config resolver can apply
 * the same auth-resolution code path to both registries via a shared
 * helper. See `packages/api/src/lib/mcp-configs.ts`.
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
// admin_mcp_servers — tenant-scoped registry of admin-only MCP servers
// ---------------------------------------------------------------------------

export const adminMcpServers = pgTable(
  "admin_mcp_servers",
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
    /** @deprecated — use RFC 9728 discovery instead. Kept for tenant-MCP parity. */
    oauth_provider: text("oauth_provider"),
    /** Cached tool list from discovery: [{ name: string, description?: string }] */
    tools: jsonb("tools"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Admin-approval gate, identical to `tenant_mcp_servers.status`.
     * 'pending' blocks invocation; 'approved' unlocks it; 'rejected' is
     * terminal. CHECK-constrained in the migration to the three-value
     * domain.
     */
    status: text("status").notNull().default("approved"),
    /**
     * sha256 of (url, auth_config) captured at approve time. Mutating url
     * or auth_config on an `approved` row reverts status to 'pending' and
     * clears approval metadata, matching the tenant-MCP invariant SI-5.
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
    uniqueIndex("uq_admin_mcp_servers_slug").on(table.tenant_id, table.slug),
    index("idx_admin_mcp_servers_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// agent_admin_mcp_servers — per-agent admin-MCP enablement
// ---------------------------------------------------------------------------

export const agentAdminMcpServers = pgTable(
  "agent_admin_mcp_servers",
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
      .references(() => adminMcpServers.id)
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
    uniqueIndex("uq_agent_admin_mcp_servers").on(
      table.agent_id,
      table.mcp_server_id,
    ),
    index("idx_agent_admin_mcp_servers_agent").on(table.agent_id),
  ],
);

// ---------------------------------------------------------------------------
// agent_template_admin_mcp_servers — template-level admin-MCP assignment
// ---------------------------------------------------------------------------

export const agentTemplateAdminMcpServers = pgTable(
  "agent_template_admin_mcp_servers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    template_id: uuid("template_id").notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    mcp_server_id: uuid("mcp_server_id")
      .references(() => adminMcpServers.id)
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
    uniqueIndex("uq_agent_template_admin_mcp_servers").on(
      table.template_id,
      table.mcp_server_id,
    ),
    index("idx_agent_template_admin_mcp_servers_template").on(table.template_id),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const adminMcpServersRelations = relations(
  adminMcpServers,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [adminMcpServers.tenant_id],
      references: [tenants.id],
    }),
    agentAssignments: many(agentAdminMcpServers),
  }),
);

export const agentAdminMcpServersRelations = relations(
  agentAdminMcpServers,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentAdminMcpServers.agent_id],
      references: [agents.id],
    }),
    tenant: one(tenants, {
      fields: [agentAdminMcpServers.tenant_id],
      references: [tenants.id],
    }),
    mcpServer: one(adminMcpServers, {
      fields: [agentAdminMcpServers.mcp_server_id],
      references: [adminMcpServers.id],
    }),
  }),
);

export const agentTemplateAdminMcpServersRelations = relations(
  agentTemplateAdminMcpServers,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [agentTemplateAdminMcpServers.tenant_id],
      references: [tenants.id],
    }),
    mcpServer: one(adminMcpServers, {
      fields: [agentTemplateAdminMcpServers.mcp_server_id],
      references: [adminMcpServers.id],
    }),
  }),
);
