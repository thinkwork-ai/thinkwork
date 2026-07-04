/**
 * Artifact version chain (Living Artifacts / THINK-145, KTD3).
 *
 * A canvas artifact's living head is an overwrite-in-place working copy stored
 * on `artifacts`. Pinning — and check-in, which auto-pins the prior head —
 * appends a content-addressed, write-once row here. Version history is
 * user-visible and any pinned version can be viewed (read-only in v1).
 *
 * The content-addressed S3 key is written once and never mutated (two-key
 * rule): the head keeps its overwrite-in-place key, each pin gets a distinct
 * revision-keyed key.
 */

import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { artifacts } from "./artifacts";

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    // Versions belong to their artifact: cascade the delete.
    artifact_id: uuid("artifact_id")
      .references(() => artifacts.id, { onDelete: "cascade" })
      .notNull(),

    // Monotonic version number within an artifact (1-based pins).
    version: integer("version").notNull(),

    // Content-addressed, write-once S3 key for this pinned revision.
    s3_key: text("s3_key").notNull(),
    // Hash of the pinned content (content addressing / integrity).
    content_hash: text("content_hash").notNull(),

    // User who created the pin. Nullable + SET NULL so user deletion does not
    // orphan the version chain.
    created_by: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_artifact_versions_tenant_id").on(table.tenant_id),
    index("idx_artifact_versions_artifact_id").on(table.artifact_id),
    // A version number is unique within an artifact.
    uniqueIndex("uq_artifact_versions_artifact_version").on(
      table.artifact_id,
      table.version,
    ),
  ],
);

export const artifactVersionsRelations = relations(
  artifactVersions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [artifactVersions.tenant_id],
      references: [tenants.id],
    }),
    artifact: one(artifacts, {
      fields: [artifactVersions.artifact_id],
      references: [artifacts.id],
    }),
    createdByUser: one(users, {
      fields: [artifactVersions.created_by],
      references: [users.id],
    }),
  }),
);
