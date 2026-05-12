/**
 * Agent template & version tables.
 *
 * An Agent Template defines the full capability and security posture for agents:
 * model, guardrail, blocked tools, skills, knowledge bases, workspace.
 * Templates are a security boundary — agents inherit model, guardrail, and
 * blocked tools from their template via a mandatory template_id FK.
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
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";
import { agents } from "./agents.js";
import { guardrails } from "./guardrails.js";

// ---------------------------------------------------------------------------
// agent_templates
// ---------------------------------------------------------------------------

export const agentTemplates = pgTable(
  "agent_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id").references(() => tenants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    /** 'system' = platform-provided, 'user' = tenant-created */
    source: text("source").notNull().default("user"),
    /** Default runtime substrate for agents created from this template. */
    runtime: text("runtime").notNull().default("strands"),
    /** Template category in the ThinkWork Computer product model. */
    template_kind: text("template_kind").notNull().default("agent"),
    /** The Bedrock model agents in this template use */
    model: text("model"),
    /** Guardrail assigned to this template (null = inherit tenant default) */
    guardrail_id: uuid("guardrail_id").references(() => guardrails.id),
    /** Tools blocked for agents in this template: string[] */
    blocked_tools: jsonb("blocked_tools"),
    /** Agent config: role, other non-security settings */
    config: jsonb("config"),
    /** Skill assignments: [{ skill_id, config?, permissions?, enabled, model_override? }] */
    skills: jsonb("skills"),
    /** KB UUIDs to assign on creation */
    knowledge_base_ids: jsonb("knowledge_base_ids"),
    /**
     * Sandbox opt-in metadata for the AgentCore Code Interpreter sandbox
     * (plan Unit 3). Shape: { environment: 'default-public' | 'internal-only' }
     * | null. Null = template does not use
     * the sandbox; `execute_code` is not registered for its agents.
     *
     * Shape is validated at create/update mutation time by
     * packages/api/src/lib/templates/sandbox-config.ts — the DB column is
     * plain jsonb because Drizzle has no enum-inside-jsonb primitive; the
     * validator is the gate.
     */
    sandbox: jsonb("sandbox"),
    /**
     * Browser Automation opt-in metadata for the AgentCore Browser + Nova Act
     * built-in tool. Shape: { enabled: true } | null. Null = template does not
     * register browser_automation unless an agent-level capability override
     * enables it.
     *
     * Shape is validated at create/update mutation time by
     * packages/api/src/lib/templates/browser-config.ts.
     */
    browser: jsonb("browser"),
    /**
     * Web Search opt-in metadata for the tenant-configured web-search built-in
     * tool. Shape: { enabled: true } | null. Null = the template does not
     * inject web-search even when the tenant has a provider/API key configured.
     *
     * Shape is validated at create/update mutation time by
     * packages/api/src/lib/templates/web-search-config.ts.
     */
    web_search: jsonb("web_search").default(sql`'{"enabled": true}'::jsonb`),
    /**
     * Send Email opt-in metadata for the platform email-sending built-in tool.
     * Shape: { enabled: true } | null. Null = the template does not register
     * send_email even when the agent email channel is enabled.
     *
     * Shape is validated at create/update mutation time by
     * packages/api/src/lib/templates/send-email-config.ts.
     */
    send_email: jsonb("send_email").default(sql`'{"enabled": true}'::jsonb`),
    /**
     * Context Engine opt-in metadata for the query_context built-in tool.
     * Shape: { enabled: true } | null. Null = the template does not register
     * query_context for Strands/PI turns.
     *
     * Shape is validated at create/update mutation time by
     * packages/api/src/lib/templates/context-engine-config.ts.
     */
    context_engine: jsonb("context_engine").default(
      sql`'{"enabled": true}'::jsonb`,
    ),
    is_published: boolean("is_published").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_templates_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
    uniqueIndex("uq_agent_templates_tenant_id_id").on(
      table.tenant_id,
      table.id,
    ),
    index("idx_agent_templates_tenant").on(table.tenant_id),
    index("idx_agent_templates_category").on(table.category),
    index("idx_agent_templates_source").on(table.source),
    index("idx_agent_templates_kind").on(table.template_kind),
    check(
      "agent_templates_kind_allowed",
      sql`${table.template_kind} IN ('agent','computer')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// agent_versions
// ---------------------------------------------------------------------------

export const agentVersions = pgTable(
  "agent_versions",
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
    version_number: integer("version_number").notNull(),
    label: text("label"),
    config_snapshot: jsonb("config_snapshot"),
    workspace_snapshot: jsonb("workspace_snapshot"),
    skills_snapshot: jsonb("skills_snapshot"),
    knowledge_bases_snapshot: jsonb("knowledge_bases_snapshot"),
    guardrail_snapshot: jsonb("guardrail_snapshot"),
    created_by: uuid("created_by").references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    is_active: boolean("is_active").notNull().default(false),
  },
  (table) => [
    index("idx_agent_versions_agent").on(table.agent_id),
    uniqueIndex("uq_agent_versions_agent_version").on(
      table.agent_id,
      table.version_number,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const agentTemplatesRelations = relations(
  agentTemplates,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [agentTemplates.tenant_id],
      references: [tenants.id],
    }),
    guardrail: one(guardrails, {
      fields: [agentTemplates.guardrail_id],
      references: [guardrails.id],
    }),
    agents: many(agents),
  }),
);

export const agentVersionsRelations = relations(agentVersions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [agentVersions.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [agentVersions.agent_id],
    references: [agents.id],
  }),
  createdBy: one(users, {
    fields: [agentVersions.created_by],
    references: [users.id],
  }),
}));
