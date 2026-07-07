/**
 * Public artifact share links (THINK-208).
 *
 * One row per public "anyone with the link" share grant on a document
 * artifact. The share URL token is an HMAC signature over `id` — no token
 * material is stored at rest; the URL is re-derivable at any time by
 * re-signing the row id (which is what makes get-or-create re-sharing work).
 *
 * Lifecycle is revoke-only: rows are never deleted on revoke, `revoked_at`
 * flips them dead so the history stays queryable. Deleting the artifact
 * cascades the rows away, killing the link (R10).
 */

import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { artifacts } from "./artifacts";

export const artifactShares = pgTable(
  "artifact_shares",
  {
    // The share id the URL token signs over.
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    artifact_id: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    revoked_by: uuid("revoked_by").references(() => users.id),
  },
  (table) => [
    // One active public link per artifact: mint is get-or-create against
    // the live row, so re-sharing resurfaces the same URL (R4).
    uniqueIndex("artifact_shares_active_artifact_uidx")
      .on(table.artifact_id)
      .where(sql`${table.revoked_at} IS NULL`),
    // Operator tenant-wide share list, newest first.
    index("artifact_shares_tenant_created_idx").on(
      table.tenant_id,
      table.created_at,
    ),
  ],
);
