/**
 * Code Factory domain tables: repos, jobs, runs, webhook deliveries, GitHub App installations.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// 4.5 — code_factory_repos
// ---------------------------------------------------------------------------

export const codeFactoryRepos = pgTable(
	"code_factory_repos",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		github_owner: text("github_owner").notNull(),
		github_repo: text("github_repo").notNull(),
		github_installation_id: integer("github_installation_id"),
		default_branch: text("default_branch"),
		status: text("status").notNull().default("active"),
		config: jsonb("config"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_code_factory_repos_owner_repo").on(
			table.github_owner,
			table.github_repo,
		),
	],
);

// ---------------------------------------------------------------------------
// 4.6 — code_factory_jobs
// ---------------------------------------------------------------------------

export const codeFactoryJobs = pgTable("code_factory_jobs", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	repo_id: uuid("repo_id")
		.references(() => codeFactoryRepos.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	agent_id: uuid("agent_id").references(() => agents.id),
	name: text("name").notNull(),
	type: text("type").notNull(),
	config: jsonb("config"),
	status: text("status").notNull().default("active"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 4.7 — code_factory_runs
// ---------------------------------------------------------------------------

export const codeFactoryRuns = pgTable("code_factory_runs", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	job_id: uuid("job_id")
		.references(() => codeFactoryJobs.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	status: text("status").notNull().default("pending"),
	commit_sha: text("commit_sha"),
	branch: text("branch"),
	started_at: timestamp("started_at", { withTimezone: true }),
	completed_at: timestamp("completed_at", { withTimezone: true }),
	error: text("error"),
	metadata: jsonb("metadata"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 4.8 — github_webhook_deliveries
// ---------------------------------------------------------------------------

export const githubWebhookDeliveries = pgTable("github_webhook_deliveries", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	event_type: text("event_type").notNull(),
	delivery_id: text("delivery_id"),
	payload: jsonb("payload"),
	status: text("status").notNull().default("pending"),
	processed_at: timestamp("processed_at", { withTimezone: true }),
	error: text("error"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 4.9 — github_app_installations
// ---------------------------------------------------------------------------

export const githubAppInstallations = pgTable("github_app_installations", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	installation_id: integer("installation_id").notNull().unique(),
	account_login: text("account_login").notNull(),
	account_type: text("account_type").notNull(),
	status: text("status").notNull().default("active"),
	permissions: jsonb("permissions"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const codeFactoryReposRelations = relations(
	codeFactoryRepos,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [codeFactoryRepos.tenant_id],
			references: [tenants.id],
		}),
		jobs: many(codeFactoryJobs),
	}),
);

export const codeFactoryJobsRelations = relations(
	codeFactoryJobs,
	({ one, many }) => ({
		repo: one(codeFactoryRepos, {
			fields: [codeFactoryJobs.repo_id],
			references: [codeFactoryRepos.id],
		}),
		tenant: one(tenants, {
			fields: [codeFactoryJobs.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [codeFactoryJobs.agent_id],
			references: [agents.id],
		}),
		runs: many(codeFactoryRuns),
	}),
);

export const codeFactoryRunsRelations = relations(
	codeFactoryRuns,
	({ one }) => ({
		job: one(codeFactoryJobs, {
			fields: [codeFactoryRuns.job_id],
			references: [codeFactoryJobs.id],
		}),
		tenant: one(tenants, {
			fields: [codeFactoryRuns.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const githubWebhookDeliveriesRelations = relations(
	githubWebhookDeliveries,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [githubWebhookDeliveries.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const githubAppInstallationsRelations = relations(
	githubAppInstallations,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [githubAppInstallations.tenant_id],
			references: [tenants.id],
		}),
	}),
);
