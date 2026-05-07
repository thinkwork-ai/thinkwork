import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { connectorExecutions } from "../src/schema/connector-executions";
import { connectors } from "../src/schema/connectors";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0065 = readFileSync(
	join(HERE, "..", "drizzle", "0065_connector_tables.sql"),
	"utf-8",
);
const rollback0065 = readFileSync(
	join(HERE, "..", "drizzle", "0065_connector_tables_rollback.sql"),
	"utf-8",
);
const migration0071 = readFileSync(
	join(HERE, "..", "drizzle", "0071_connector_computer_dispatch_target.sql"),
	"utf-8",
);
const rollback0071 = readFileSync(
	join(
		HERE,
		"..",
		"drizzle",
		"0071_connector_computer_dispatch_target_rollback.sql",
	),
	"utf-8",
);

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
	getTableConfig(table).indexes.map((index) => index.config.name);

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
	getTableConfig(table).checks.map((check) => check.name);

describe("connector schema", () => {
	it("declares connector lifecycle checks and indexes in Drizzle", () => {
		const columns = getTableColumns(connectors);

		expect(columns.tenant_id.notNull).toBe(true);
		expect(columns.type.notNull).toBe(true);
		expect(columns.status.notNull).toBe(true);
		expect(columns.status.hasDefault).toBe(true);
		expect(columns.enabled.notNull).toBe(true);
		expect(columns.enabled.hasDefault).toBe(true);
		expect(columns.updated_at.notNull).toBe(true);
		expect(columns.updated_at.hasDefault).toBe(true);

		expect(indexNames(connectors)).toEqual(
			expect.arrayContaining([
				"uq_connectors_tenant_name",
				"idx_connectors_tenant_status",
				"idx_connectors_tenant_type",
				"idx_connectors_enabled",
			]),
		);
		expect(checkNames(connectors)).toEqual(
			expect.arrayContaining([
				"connectors_status_enum",
				"connectors_dispatch_target_type_enum_v2",
			]),
		);
	});

	it("declares connector execution active-ref uniqueness and money as bigint cents", () => {
		const columns = getTableColumns(connectorExecutions);

		expect(columns.tenant_id.notNull).toBe(true);
		expect(columns.connector_id.notNull).toBe(true);
		expect(columns.external_ref.notNull).toBe(true);
		expect(columns.current_state.notNull).toBe(true);
		expect(columns.current_state.hasDefault).toBe(true);
		expect(columns.spend_envelope_usd_cents.columnType).toBe("PgBigInt53");
		expect(columns.spend_envelope_usd_cents.dataType).toBe("number");
		expect(columns.retry_attempt.notNull).toBe(true);
		expect(columns.retry_attempt.hasDefault).toBe(true);

		expect(indexNames(connectorExecutions)).toEqual(
			expect.arrayContaining([
				"uq_connector_executions_active_external_ref",
				"idx_connector_executions_tenant_state",
				"idx_connector_executions_connector_started",
				"idx_connector_executions_state_machine_arn",
				"idx_connector_executions_external_ref",
			]),
		);
		expect(checkNames(connectorExecutions)).toEqual(
			expect.arrayContaining([
				"connector_executions_current_state_enum",
				"connector_executions_kill_target_enum",
				"connector_executions_spend_envelope_nonnegative",
				"connector_executions_retry_attempt_nonnegative",
			]),
		);
	});
});

describe("migration 0071 — connector Computer dispatch target", () => {
	it("declares a drift-detectable v2 target constraint marker", () => {
		expect(migration0071).toMatch(
			/--\s*creates-constraint:\s*public\.connectors\.connectors_dispatch_target_type_enum_v2\b/,
		);
		expect(migration0071).not.toMatch(/creates-index:/);
	});

	it("drops the old connector target check and allows Computer targets", () => {
		expect(migration0071).toMatch(
			/DROP CONSTRAINT IF EXISTS connectors_dispatch_target_type_enum/,
		);
		expect(migration0071).toMatch(
			/ADD CONSTRAINT connectors_dispatch_target_type_enum_v2 CHECK \(\s*dispatch_target_type IN \('agent', 'routine', 'hybrid_routine', 'computer'\)/,
		);
	});

	it("restores the original target check in rollback", () => {
		expect(rollback0071).toMatch(
			/DROP CONSTRAINT IF EXISTS connectors_dispatch_target_type_enum_v2/,
		);
		expect(rollback0071).toMatch(
			/ADD CONSTRAINT connectors_dispatch_target_type_enum CHECK \(\s*dispatch_target_type IN \('agent', 'routine', 'hybrid_routine'\)/,
		);
	});
});

describe("migration 0065 — connector tables", () => {
	it("declares every drift-detected table and index with supported markers", () => {
		for (const marker of [
			"public.connectors",
			"public.connector_executions",
			"public.uq_connectors_tenant_name",
			"public.idx_connectors_tenant_status",
			"public.idx_connectors_tenant_type",
			"public.idx_connectors_enabled",
			"public.uq_connector_executions_active_external_ref",
			"public.idx_connector_executions_tenant_state",
			"public.idx_connector_executions_connector_started",
			"public.idx_connector_executions_state_machine_arn",
			"public.idx_connector_executions_external_ref",
		]) {
			expect(migration0065).toMatch(
				new RegExp(`--\\s*creates:\\s*${marker.replace(".", "\\.")}\\b`),
			);
		}

		expect(migration0065).not.toMatch(/creates-index:/);
	});

	it("keeps SQL constraints aligned with the planned inert execution surface", () => {
		expect(migration0065).toMatch(
			/CONSTRAINT connectors_status_enum CHECK \(\s*status IN \('active', 'paused', 'unhealthy', 'archived'\)/,
		);
		expect(migration0065).toMatch(
			/CONSTRAINT connectors_dispatch_target_type_enum CHECK \(\s*dispatch_target_type IN \('agent', 'routine', 'hybrid_routine'\)/,
		);
		expect(migration0065).toMatch(
			/CONSTRAINT connector_executions_current_state_enum CHECK \(\s*current_state IN \(\s*'pending',\s*'dispatching',\s*'invoking',\s*'recording_result',\s*'terminal',\s*'failed',\s*'cancelled'/,
		);
		expect(migration0065).toMatch(
			/CONSTRAINT connector_executions_spend_envelope_nonnegative CHECK \(\s*spend_envelope_usd_cents IS NULL OR spend_envelope_usd_cents >= 0/,
		);
		expect(migration0065).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_executions_active_external_ref\s+ON public\.connector_executions \(connector_id, external_ref\)\s+WHERE current_state IN \(\s*'pending',\s*'dispatching',\s*'invoking',\s*'recording_result'/,
		);
	});

	it("uses the intended FK delete behavior", () => {
		expect(migration0065).toMatch(
			/tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE/,
		);
		expect(migration0065).toMatch(
			/connection_id uuid REFERENCES public\.connections\(id\) ON DELETE SET NULL/,
		);
		expect(migration0065).toMatch(
			/connector_id uuid NOT NULL REFERENCES public\.connectors\(id\) ON DELETE RESTRICT/,
		);
	});

	it("rolls back execution rows before connector rows", () => {
		const dropExecutionsOffset = rollback0065.indexOf(
			"DROP TABLE IF EXISTS public.connector_executions",
		);
		const dropConnectorsOffset = rollback0065.indexOf(
			"DROP TABLE IF EXISTS public.connectors",
		);

		expect(dropExecutionsOffset).toBeGreaterThanOrEqual(0);
		expect(dropConnectorsOffset).toBeGreaterThanOrEqual(0);
		expect(dropExecutionsOffset).toBeLessThan(dropConnectorsOffset);
	});
});
