/**
 * Isolated Drizzle descriptors for the bounded WorkOS rollback tables.
 *
 * These deliberately do not live in @thinkwork/database-pg/schema: migration
 * 0263 drops the physical tables after retirement, and the canonical schema
 * must not cause a later db:push to recreate them. The rollback-only runtime
 * can use these descriptors while the stage remains in coexistence/cutover.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const legacyWorkosAuthBridges = pgTable("workos_auth_bridges", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenant_id: uuid("tenant_id").notNull(),
  tenant_auth_provider_reference_id: uuid(
    "tenant_auth_provider_reference_id",
  ).notNull(),
  auth_provider_resource_id: uuid("auth_provider_resource_id").notNull(),
  bridge_code_digest: text("bridge_code_digest").notNull(),
  workos_user_id: text("workos_user_id").notNull(),
  workos_session_id: text("workos_session_id").notNull(),
  workos_session_expires_at: timestamp("workos_session_expires_at", {
    withTimezone: true,
  }),
  workos_email: text("workos_email").notNull(),
  workos_email_verified: boolean("workos_email_verified")
    .notNull()
    .default(false),
  workos_profile: jsonb("workos_profile")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  state_nonce: text("state_nonce").notNull(),
  redirect_uri: text("redirect_uri").notNull(),
  return_to: text("return_to").notNull(),
  status: text("status").notNull().default("pending"),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumed_at: timestamp("consumed_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const legacyWorkosAuthSessions = pgTable("workos_auth_sessions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenant_id: uuid("tenant_id").notNull(),
  user_id: uuid("user_id").notNull(),
  tenant_auth_provider_reference_id: uuid(
    "tenant_auth_provider_reference_id",
  ).notNull(),
  auth_provider_resource_id: uuid("auth_provider_resource_id").notNull(),
  cognito_principal_id: text("cognito_principal_id").notNull(),
  cognito_username: text("cognito_username").notNull(),
  workos_user_id: text("workos_user_id").notNull(),
  workos_session_id: text("workos_session_id").notNull(),
  workos_email: text("workos_email").notNull(),
  status: text("status").notNull().default("active"),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  logged_out_at: timestamp("logged_out_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
