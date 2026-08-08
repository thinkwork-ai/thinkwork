/**
 * user_brain_claims — per-(tenant, user) Company Brain authorization claims
 * (THINK-625).
 *
 * The Brain MCP server is DB-free: it learns what a signed-in human may see
 * from a per-tenant manifest this product publishes to the brain-artifacts
 * bucket (`user-claims/<tenantId>/latest.json`, format `user-claims/v1`).
 * These rows are the write side of that manifest — the same relationship
 * tenant_mcp_twin_keys has with twin-mcp-keys/v2.
 *
 * Claims live here rather than on `users` because they are per-tenant (the
 * tenant edge is tenant_members, and `users.tenant_id` is only a home
 * tenant) and because dozens of resolvers read `users` broadly — authz data
 * does not belong in that blast radius.
 *
 * Grant semantics (mirrors the tkt_ key grants):
 *   - `security_groups` / `kb_collections`: `[]` = none, `['*']` = all.
 *   - `tool_allowlist`: NULL is DISTINCT from `{}` — NULL means "the Brain's
 *     surface default applies", `{}` means "no tools at all". Do not
 *     collapse the two.
 *   - `enabled = false` still publishes an entry (as `disabled: true`), so
 *     the Brain fails closed instead of falling back to legacy grants.
 *
 * See drizzle/0284_user_brain_claims.sql for the canonical DDL (plus
 * 0286 for analytics_key) — this
 * Drizzle schema mirrors that hand-rolled file (not registered in
 * meta/_journal.json); apply via psql.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";

/** Grant value meaning "every group" / "every collection". */
export const USER_BRAIN_CLAIM_WILDCARD = "*";

export const userBrainClaims = pgTable(
  "user_brain_claims",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    user_id: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** Graph security groups; empty = PUBLIC only, `['*']` = every group. */
    security_groups: text("security_groups")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /** KB collections; KB is grant-only, so empty = no KB access. */
    kb_collections: text("kb_collections")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /** `{ "<bundle>": ["<collection>", ...] }`. */
    kb_bundles: jsonb("kb_bundles")
      .notNull()
      .default(sql`'{}'::jsonb`),
    default_kb_bundle: text("default_kb_bundle"),
    /**
     * Allowed Brain tool names. NULL = surface default (no narrowing);
     * `{}` = no tools. The NULL/empty distinction is load-bearing.
     */
    tool_allowlist: text("tool_allowlist").array(),
    /** Enables operator-only Brain tools, subject to account env gates. */
    is_operator: boolean("is_operator").notNull().default(false),
    /** Diagnostic, not a grant: echoes KB retrieval traces to the user. */
    kb_trace: boolean("kb_trace").notNull().default(false),
    /**
     * Analytics-channel visibility (THINK-656 D4): emitted to the manifest
     * as `analyticsKey` so the user's brain_ask loop may consult the
     * mart_analytics briefing tools. Tool visibility, not a data grant —
     * default TRUE (all users get analytics unless an operator opts them
     * out).
     */
    analytics_key: boolean("analytics_key").notNull().default(true),
    /** False publishes the entry as `disabled: true` — never omits it. */
    enabled: boolean("enabled").notNull().default(true),
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** Nullable: service/backfill writes have no attributable user. */
    updated_by_user_id: uuid("updated_by_user_id"),
  },
  (table) => [
    uniqueIndex("uq_user_brain_claims_tenant_user").on(
      table.tenant_id,
      table.user_id,
    ),
    index("idx_user_brain_claims_tenant").on(table.tenant_id),
  ],
);

export const userBrainClaimsRelations = relations(
  userBrainClaims,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [userBrainClaims.tenant_id],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [userBrainClaims.user_id],
      references: [users.id],
    }),
  }),
);
