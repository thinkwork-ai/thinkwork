import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";

export const managedApplications = pgTable(
  "managed_applications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    display_name: text("display_name").notNull(),
    desired_status: text("desired_status").notNull().default("disabled"),
    current_status: text("current_status").notNull().default("unknown"),
    desired_config: jsonb("desired_config").notNull().default({}),
    selected_release_version: text("selected_release_version"),
    selected_manifest_digest: text("selected_manifest_digest"),
    last_job_id: uuid("last_job_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("managed_applications_tenant_key_uidx").on(
      table.tenant_id,
      table.key,
    ),
    index("managed_applications_tenant_status_idx").on(
      table.tenant_id,
      table.current_status,
    ),
  ],
);

export const managedApplicationDeploymentJobs = pgTable(
  "managed_application_deployment_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    application_id: uuid("application_id").references(
      () => managedApplications.id,
      { onDelete: "set null" },
    ),
    app_key: text("app_key").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull().default("planning"),
    idempotency_key: text("idempotency_key").notNull(),
    requested_by_user_id: uuid("requested_by_user_id"),
    release_version: text("release_version").notNull(),
    manifest_digest: text("manifest_digest").notNull(),
    desired_config_version: text("desired_config_version").notNull(),
    state_machine_arn: text("state_machine_arn"),
    plan_execution_arn: text("plan_execution_arn"),
    apply_execution_arn: text("apply_execution_arn"),
    codebuild_build_arn: text("codebuild_build_arn"),
    plan_digest: text("plan_digest"),
    plan_summary: jsonb("plan_summary").notNull().default({}),
    data_impact: jsonb("data_impact").notNull().default({}),
    evidence_bucket: text("evidence_bucket"),
    evidence_prefix: text("evidence_prefix"),
    approval_required: boolean("approval_required").notNull().default(true),
    approved_by_user_id: uuid("approved_by_user_id"),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_by_user_id: uuid("rejected_by_user_id"),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("managed_deployment_jobs_tenant_idempotency_uidx").on(
      table.tenant_id,
      table.idempotency_key,
    ),
    index("managed_deployment_jobs_tenant_app_idx").on(
      table.tenant_id,
      table.app_key,
    ),
    index("managed_deployment_jobs_status_idx").on(table.status),
  ],
);

export const managedApplicationDeploymentEvents = pgTable(
  "managed_application_deployment_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => managedApplicationDeploymentJobs.id, {
        onDelete: "cascade",
      }),
    event_type: text("event_type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").notNull().default({}),
    idempotency_key: text("idempotency_key"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("managed_deployment_events_job_created_idx").on(
      table.job_id,
      table.created_at,
    ),
    uniqueIndex("managed_deployment_events_idempotency_uidx")
      .on(table.job_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
  ],
);
