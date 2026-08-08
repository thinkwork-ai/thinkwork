/**
 * tenant_mcp_twin_keys — per-tenant Bearer keys for the Company Brain MCP
 * server (THINK-333).
 *
 * The agent path to `/mcp/twin` authenticates with a `tkt_` key; the
 * handler hashes the incoming Bearer with SHA-256 and looks it up here —
 * the matched row IS the tenant selection (no tenant id embedded in the
 * token). Raw keys are never stored. Mirrors tenant_mcp_admin_keys.
 *
 * See drizzle/0274_tenant_mcp_twin_keys.sql for the canonical DDL (plus
 * 0281 for suffix/expiry, 0282 for the grant columns, 0285 for the
 * trusted-subsystem marker and 0286 for analytics_key) — this Drizzle
 * schema mirrors that hand-rolled DDL (not registered in
 * meta/_journal.json); apply via psql.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core.js";

export const tenantMcpTwinKeys = pgTable(
  "tenant_mcp_twin_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** SHA-256 hex digest of the raw `tkt_` key; raw value never stored. */
    key_hash: text("key_hash").notNull(),
    /** Human label; "default" for the provisioned connector key. */
    name: text("name").notNull(),
    /**
     * Last 8 chars of the raw key, stored for display ("…a1b2c3d4") —
     * the only fragment of the raw value ever persisted. Nullable for
     * rows minted before the Brain API keys surface.
     */
    key_suffix: text("key_suffix"),
    /**
     * NULL = never expires. Enforced by the platform Brain MCP verifier
     * via the published manifest's expiresAt, not by this database.
     */
    expires_at: timestamp("expires_at", { withTimezone: true }),
    /**
     * Graph security groups this key may see, on top of the always-visible
     * PUBLIC group. Empty = PUBLIC only; `["*"]` = every group (what the
     * provisioned "default" connector key carries). Enforced platform-side
     * from the published manifest (twin-mcp-keys/v2), not by this database.
     */
    security_groups: text("security_groups")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /**
     * KB collection slugs this key may retrieve. KB is grant-only: empty =
     * no KB access at all; `["*"]` = every collection.
     */
    kb_collections: text("kb_collections")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /**
     * Trusted-subsystem marker (THINK-626): true lets this key assert
     * `on_behalf_of` per tools/call, so the call runs under the named
     * signed-in human's user-claims entry instead of the key's own grants.
     * NOT a grant — it swaps the acting principal — so it belongs only on
     * platform-held keys (the provisioned "default" connector key), never
     * on one handed to a customer's client. Enforced platform-side from
     * the published manifest (twin-mcp-keys/v2), not by this database.
     */
    trusted_subsystem: boolean("trusted_subsystem").notNull().default(false),
    /**
     * Analytics-channel visibility (THINK-656 D4): emitted to the manifest
     * as `analyticsKey: true` so the key's brain_ask loop may consult the
     * mart_analytics briefing tools. Tool visibility, not a data grant —
     * hence default TRUE (every key gets analytics unless an operator
     * turns it off). Enforced platform-side from the published manifest.
     */
    analytics_key: boolean("analytics_key").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Nullable for service-provisioned keys with no attributable user. */
    created_by_user_id: uuid("created_by_user_id"),
    /** Bumped on successful auth; async, best-effort. */
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    /** Soft-delete; NULL = active. Rotation revokes the old row. */
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    uq_hash: uniqueIndex("uq_tenant_mcp_twin_keys_hash").on(t.key_hash),
    // The active-name partial unique index is declared in the raw SQL
    // migration (WHERE revoked_at IS NULL) — same convention as
    // tenant_mcp_admin_keys (see mcp-admin-keys.ts for why).
    idx_tenant: index("idx_tenant_mcp_twin_keys_tenant").on(
      t.tenant_id,
      t.created_at,
    ),
  }),
);
