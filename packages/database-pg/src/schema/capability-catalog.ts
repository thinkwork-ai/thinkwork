/**
 * Capability catalog + resolved capability manifests (plan §U15, SI-7).
 *
 * Two tables that back the Resolved Capability Manifest story:
 *
 *   capability_catalog
 *     Unified declaration of every thing an agent session can invoke —
 *     skills, built-in tools, and MCP server pointers. A session's
 *     effective tool list is a filter over this table, not an ad-hoc
 *     Python registration. A capability without a catalog row cannot
 *     appear in the manifest, and a manifest-absent capability cannot
 *     register at `Agent(tools=...)` construction (SI-7).
 *
 *   resolved_capability_manifests
 *     Append-only audit. One row per agent-session-start. 30-day TTL —
 *     the sampled-retention story for longer horizons (plan §Risks) is
 *     a separate cron, not this schema.
 *
 * Ship plan: this PR (U15 part 1/3) lands schema + the narrow REST
 * write endpoint inert. U15 part 2 wires Python capture + admin UI;
 * part 3 turns on SI-7 enforcement in `Agent(tools=...)`.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";
import { agents } from "./agents.js";

// ---------------------------------------------------------------------------
// capability_catalog — unified skill / tool / MCP registry
// ---------------------------------------------------------------------------

export const capabilityCatalog = pgTable(
  "capability_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** URL-safe identifier. Unique across (type, source) — slugs can overlap only when they describe the same capability (e.g., a tenant-library skill with the same slug as a community one). */
    slug: text("slug").notNull(),
    /** 'skill' | 'tool' | 'mcp-server'. CHECK-constrained in migration 0027. */
    type: text("type").notNull(),
    /** 'builtin' | 'tenant-library' | 'community'. CHECK-constrained in migration 0027. */
    source: text("source").notNull(),
    /**
     * Pointer to the concrete implementation the runtime instantiates.
     *   - type='tool', source='builtin': `{ module_path, class_name }` — the
     *     Strands harness imports it on startup.
     *   - type='skill': null (U4 skill_dispatcher owns dispatch).
     *   - type='mcp-server': `{ mcp_server_id }` pointing at tenant_mcp_servers.
     */
    implementation_ref: jsonb("implementation_ref"),
    /**
     * Declarative metadata about the capability — display name, description,
     * input/output hints, required scopes. The manifest-capture layer (U15
     * part 2) reads this and echoes a subset into the per-session manifest.
     */
    spec: jsonb("spec"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_capability_catalog_type_source_slug").on(
      table.type,
      table.source,
      table.slug,
    ),
    index("idx_capability_catalog_type").on(table.type),
    index("idx_capability_catalog_source").on(table.source),
  ],
);

// ---------------------------------------------------------------------------
// resolved_capability_manifests — one row per agent session start
// ---------------------------------------------------------------------------

export const resolvedCapabilityManifests = pgTable(
  "resolved_capability_manifests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** AgentCore session id. Not unique — a container session can be reused across invocations within its lifetime, but each invocation gets its own manifest row. */
    session_id: text("session_id").notNull(),
    agent_id: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    /** Template id at session construction. Nullable so a free-form agent session (no template) still captures a manifest. */
    template_id: uuid("template_id"),
    /** Cognito principal / authenticated user id. Nullable for system-attributed sessions. */
    user_id: uuid("user_id"),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * The full resolved manifest shape captured at session start.
     * Structure (per plan §U15 technical design):
     *   {
     *     skills: [{slug, version, source}],
     *     tools: [{slug, source, implementation_ref}],
     *     mcp_servers: [{id, url_hash, status}],
     *     workspace_files: [{path, version}],
     *     blocks: { tenant_disabled_builtins: [], template_blocked_tools: [] },
     *     runtime_version: string,
     *     ... + any forward-compatible fields
     *   }
     * Kept as an opaque JSONB so the runtime can evolve the schema without
     * a DB migration per field; the admin UI renders whatever shape lands.
     */
    manifest_json: jsonb("manifest_json").notNull(),
    /** Emitted by the runtime, not `now()`, so the row captures the session's
     * actual start time even if the manifest-log handler is briefly queued. */
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_rcm_tenant").on(table.tenant_id),
    index("idx_rcm_agent").on(table.agent_id),
    index("idx_rcm_template").on(table.template_id),
    index("idx_rcm_created_at").on(table.created_at),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const resolvedCapabilityManifestsRelations = relations(
  resolvedCapabilityManifests,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [resolvedCapabilityManifests.tenant_id],
      references: [tenants.id],
    }),
    agent: one(agents, {
      fields: [resolvedCapabilityManifests.agent_id],
      references: [agents.id],
    }),
  }),
);
