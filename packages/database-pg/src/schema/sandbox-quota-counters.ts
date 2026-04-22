/**
 * sandbox_tenant_daily_counters + sandbox_agent_hourly_counters
 *
 * Atomic-increment counter tables backing the sandbox cost-cap circuit breaker
 * (plan Unit 10). Each executeCode call runs an atomic UPSERT with a `WHERE
 * count < :cap` guard; zero rows returned signals the cap was breached.
 *
 * Boundaries are server-side (CURRENT_DATE / date_trunc('hour', NOW())) — never
 * client-computed — so UTC-midnight skew doesn't split an in-flight second
 * into two different counter rows.
 *
 * Lock-order invariant: every caller UPSERTs tenant_daily first, then
 * agent_hourly, inside one transaction. Violating the order risks deadlock at
 * 400+ agents.
 */

import {
  pgTable,
  uuid,
  integer,
  timestamp,
  primaryKey,
  date,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

export const sandboxTenantDailyCounters = pgTable(
  "sandbox_tenant_daily_counters",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    utc_date: date("utc_date").notNull(),
    invocations_count: integer("invocations_count").notNull().default(0),
    // Rolling sum of observed call durations (in seconds). Feeds the
    // 50-min/day/tenant wall-clock cap.
    wall_clock_seconds: integer("wall_clock_seconds").notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.tenant_id, table.utc_date] })],
);

export const sandboxAgentHourlyCounters = pgTable(
  "sandbox_agent_hourly_counters",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    utc_hour: timestamp("utc_hour", { withTimezone: true }).notNull(),
    invocations_count: integer("invocations_count").notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      columns: [table.tenant_id, table.agent_id, table.utc_hour],
    }),
  ],
);

export const sandboxTenantDailyCountersRelations = relations(
  sandboxTenantDailyCounters,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [sandboxTenantDailyCounters.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const sandboxAgentHourlyCountersRelations = relations(
  sandboxAgentHourlyCounters,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [sandboxAgentHourlyCounters.tenant_id],
      references: [tenants.id],
    }),
    agent: one(agents, {
      fields: [sandboxAgentHourlyCounters.agent_id],
      references: [agents.id],
    }),
  }),
);
