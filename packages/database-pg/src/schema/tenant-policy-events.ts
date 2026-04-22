/**
 * tenant_policy_events — append-only audit of tenant-level policy changes.
 *
 * Today's scope: sandbox_enabled flips and compliance_tier changes, both
 * written by updateTenantPolicy (plan Unit 6). Rows are insert-only by
 * convention; any consumer that needs to amend a policy decision writes a
 * new row rather than updating an existing one.
 *
 * Separate from activity_log because compliance-tier transitions must be
 * retained on a different cadence (no retention sweep — regulator-visible
 * artifact) than the general activity stream.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

export const TENANT_POLICY_EVENT_TYPES = [
  "sandbox_enabled",
  "compliance_tier",
] as const;
export type TenantPolicyEventType = (typeof TENANT_POLICY_EVENT_TYPES)[number];

export const TENANT_POLICY_EVENT_SOURCES = [
  "graphql",
  "reconciler",
  "sql",
] as const;
export type TenantPolicyEventSource =
  (typeof TENANT_POLICY_EVENT_SOURCES)[number];

export const tenantPolicyEvents = pgTable(
  "tenant_policy_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    actor_user_id: uuid("actor_user_id").notNull(),
    event_type: text("event_type").notNull(),
    before_value: text("before_value"),
    after_value: text("after_value"),
    source: text("source").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_tenant_policy_events_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    check(
      "tenant_policy_events_event_type_allowed",
      sql`${table.event_type} IN ('sandbox_enabled','compliance_tier')`,
    ),
    check(
      "tenant_policy_events_source_allowed",
      sql`${table.source} IN ('graphql','reconciler','sql')`,
    ),
  ],
);

export const tenantPolicyEventsRelations = relations(
  tenantPolicyEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantPolicyEvents.tenant_id],
      references: [tenants.id],
    }),
  }),
);
