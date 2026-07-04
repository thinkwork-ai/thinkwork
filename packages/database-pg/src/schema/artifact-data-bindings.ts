/**
 * Artifact data-source bindings (Living Artifacts / THINK-145, KTD2, KTD4).
 *
 * A data source is a saved tool call. Every widget produced from a tool result
 * carries a binding — the recorded invocation that produced its data — so a
 * headless refresh can re-execute it without an agent turn. Bindings live in
 * their own table (not artifact metadata) so the refresh Lambda and the agent
 * tools can read them without loading canvas payloads from S3, and so quality
 * updates never rewrite artifact content.
 *
 * Keyed by (artifact id, part id, widget/element id).
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { artifacts } from "./artifacts";

/** Auth-context descriptor for a binding's refresh identity. */
export const ARTIFACT_BINDING_AUTH_CONTEXTS = [
  "tenant_mcp",
  "per_user_oauth",
] as const;

/** Freshness / quality state of a bound widget's data. */
export const ARTIFACT_BINDING_QUALITIES = [
  "good",
  "stale",
  "bad",
  "schema_stale",
] as const;

export const artifactDataBindings = pgTable(
  "artifact_data_bindings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    // Bindings belong to their artifact: cascade the delete.
    artifact_id: uuid("artifact_id")
      .references(() => artifacts.id, { onDelete: "cascade" })
      .notNull(),

    // Widget address within the canvas.
    part_id: text("part_id").notNull(),
    element_id: text("element_id").notNull(),

    // The saved tool call (KTD2): soft reference to the MCP server plus the
    // captured server name (server may later be removed → terminal BAD state).
    mcp_server_ref: text("mcp_server_ref").notNull(),
    server_name: text("server_name").notNull(),
    tool_name: text("tool_name").notNull(),
    // Frozen arguments of the recorded invocation. Stored unredacted; display
    // passes the KTD9 redaction gate.
    frozen_args: jsonb("frozen_args").notNull().default(sql`'{}'::jsonb`),
    // Structural hash of the result shape (sorted key structure, not values).
    // A mismatch on refresh is a schema-refresh escalation (R7).
    result_shape_hash: text("result_shape_hash").notNull(),

    // Refresh identity (R9): tenant_mcp → unattended refresh allowed;
    // per_user_oauth → agent-mediated only, owner named by owner_user_id.
    auth_context: text("auth_context").notNull(),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Freshness state (R8).
    quality: text("quality").notNull().default("good"),
    last_fetched_at: timestamp("last_fetched_at", { withTimezone: true }),
    last_good_at: timestamp("last_good_at", { withTimezone: true }),

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_artifact_data_bindings_tenant_id").on(table.tenant_id),
    index("idx_artifact_data_bindings_artifact_id").on(table.artifact_id),
    // One binding per widget address.
    uniqueIndex("uq_artifact_data_bindings_element").on(
      table.artifact_id,
      table.part_id,
      table.element_id,
    ),
    check(
      "artifact_data_bindings_auth_context_allowed",
      sql`${table.auth_context} IN ('tenant_mcp', 'per_user_oauth')`,
    ),
    check(
      "artifact_data_bindings_quality_allowed",
      sql`${table.quality} IN ('good', 'stale', 'bad', 'schema_stale')`,
    ),
  ],
);

export const artifactDataBindingsRelations = relations(
  artifactDataBindings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [artifactDataBindings.tenant_id],
      references: [tenants.id],
    }),
    artifact: one(artifacts, {
      fields: [artifactDataBindings.artifact_id],
      references: [artifacts.id],
    }),
    ownerUser: one(users, {
      fields: [artifactDataBindings.owner_user_id],
      references: [users.id],
    }),
  }),
);
