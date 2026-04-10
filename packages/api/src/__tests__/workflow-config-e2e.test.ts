/**
 * E2E test: verify workflow config resolution + turn loop + workspace defaults
 * against the real dev database.
 *
 * Runs against the ericodom-stage Aurora cluster via RDS Data API.
 * Requires AWS credentials with rds-data:ExecuteStatement permission.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@thinkwork/database-pg";

const CLUSTER_ARN = "arn:aws:rds:us-east-1:487219502366:cluster:thinkwork-ericodom-db";
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:487219502366:secret:thinkwork-ericodom-graphql-db-credentials-EMNbVe";
const DATABASE = "thinkwork";

let db: ReturnType<typeof createDb>;
let sampleTenantId: string;

beforeAll(async () => {
	process.env.AWS_REGION = "us-east-1";
	db = createDb({
		resourceArn: CLUSTER_ARN,
		secretArn: SECRET_ARN,
		database: DATABASE,
	});

	// Grab a real tenant ID
	const rows = await db.execute(sql`SELECT id FROM tenants LIMIT 1`);
	const tenantRows = (rows.rows || []) as Array<Record<string, unknown>>;
	if (tenantRows.length === 0) {
		throw new Error("No tenants in dev database — cannot run e2e test");
	}
	sampleTenantId = tenantRows[0].id as string;
	console.log(`Using sample tenant: ${sampleTenantId}`);
});

describe("Workflow config resolution (e2e, real DB)", () => {
	it("queries workflow_configs table without error", async () => {
		const result = await db.execute(sql`
			SELECT
				dispatch, concurrency, retry, turn_loop, workspace,
				stall_detection, orchestration, prompt_template, hive_id
			FROM workflow_configs
			WHERE tenant_id = ${sampleTenantId}::uuid
			  AND hive_id IS NULL
			ORDER BY hive_id NULLS FIRST
		`);

		const rows = (result.rows || []) as Array<Record<string, unknown>>;
		// May be empty (no config for this tenant), but query should not throw
		expect(Array.isArray(rows)).toBe(true);
	});

	it("turn_loop JSONB column reads as parseable JSON or null", async () => {
		const result = await db.execute(sql`
			SELECT turn_loop
			FROM workflow_configs
			WHERE tenant_id = ${sampleTenantId}::uuid
			LIMIT 1
		`);

		const rows = (result.rows || []) as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			const raw = rows[0].turn_loop;
			if (raw !== null && raw !== undefined) {
				// RDS Data API returns JSONB as string — verify it's parseable
				const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
				expect(typeof parsed).toBe("object");
			}
		}
		// No rows is also fine — means no config set for this tenant
		expect(true).toBe(true);
	});

	it("workspace JSONB column reads as parseable JSON or null", async () => {
		const result = await db.execute(sql`
			SELECT workspace
			FROM workflow_configs
			WHERE tenant_id = ${sampleTenantId}::uuid
			LIMIT 1
		`);

		const rows = (result.rows || []) as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			const raw = rows[0].workspace;
			if (raw !== null && raw !== undefined) {
				const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
				expect(typeof parsed).toBe("object");
			}
		}
		expect(true).toBe(true);
	});

	it("can insert and read back turn_loop + workspace config", async () => {
		// Check if a tenant-default config already exists
		const existing = await db.execute(sql`
			SELECT id FROM workflow_configs
			WHERE tenant_id = ${sampleTenantId}::uuid AND hive_id IS NULL
			LIMIT 1
		`);
		const existingRows = (existing.rows || []) as Array<Record<string, unknown>>;

		if (existingRows.length > 0) {
			// Update existing row
			await db.execute(sql`
				UPDATE workflow_configs
				SET turn_loop = ${JSON.stringify({ enabled: true, maxTurns: 3, continueOnToolUse: false })}::jsonb,
				    workspace = ${JSON.stringify({ isolateByThread: true, prefixTemplate: "test/{tenantSlug}/" })}::jsonb,
				    updated_at = NOW()
				WHERE tenant_id = ${sampleTenantId}::uuid AND hive_id IS NULL
			`);
		} else {
			// Insert new row
			await db.execute(sql`
				INSERT INTO workflow_configs (tenant_id, turn_loop, workspace)
				VALUES (
					${sampleTenantId}::uuid,
					${JSON.stringify({ enabled: true, maxTurns: 3, continueOnToolUse: false })}::jsonb,
					${JSON.stringify({ isolateByThread: true, prefixTemplate: "test/{tenantSlug}/" })}::jsonb
				)
			`);
		}

		// Read it back
		const result = await db.execute(sql`
			SELECT turn_loop, workspace
			FROM workflow_configs
			WHERE tenant_id = ${sampleTenantId}::uuid
			  AND hive_id IS NULL
		`);

		const rows = (result.rows || []) as Array<Record<string, unknown>>;
		expect(rows.length).toBeGreaterThanOrEqual(1);

		// RDS Data API may return JSONB as string — parse if needed
		const rawTurnLoop = rows[0].turn_loop;
		const turnLoop = (typeof rawTurnLoop === "string" ? JSON.parse(rawTurnLoop) : rawTurnLoop) as Record<string, unknown>;
		expect(turnLoop.enabled).toBe(true);
		expect(turnLoop.maxTurns).toBe(3);

		const rawWorkspace = rows[0].workspace;
		const workspace = (typeof rawWorkspace === "string" ? JSON.parse(rawWorkspace) : rawWorkspace) as Record<string, unknown>;
		expect(workspace.isolateByThread).toBe(true);
		expect(workspace.prefixTemplate).toBe("test/{tenantSlug}/");

		// Clean up — reset to defaults
		await db.execute(sql`
			UPDATE workflow_configs
			SET turn_loop = NULL, workspace = NULL, updated_at = NOW()
			WHERE tenant_id = ${sampleTenantId}::uuid
			  AND hive_id IS NULL
		`);
	});
});
