import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tenantWorkflowCatalog } from "../src/schema/tenant-customize-catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const readMigration = (name: string) =>
	readFileSync(join(HERE, "..", "drizzle", name), "utf-8");

const migration0078 = readMigration("0078_tenant_customize_catalog.sql");
const migration0079 = readMigration("0079_seed_tenant_customize_catalog.sql");
const migration0087 = readMigration("0087_retire_oss_connectors.sql");
const externalRefsSchema = readFileSync(
	join(HERE, "..", "src", "schema", "tenant-entity-external-refs.ts"),
	"utf-8",
);

describe("connector retirement schema", () => {
	it("keeps workflow catalog as the only tenant customize catalog", () => {
		expect(getTableName(tenantWorkflowCatalog)).toBe("tenant_workflow_catalog");

		const columns = getTableColumns(tenantWorkflowCatalog);
		expect(columns.tenant_id.notNull).toBe(true);
		expect(columns.slug.notNull).toBe(true);
		expect(columns.display_name.notNull).toBe(true);
		expect(columns.status.notNull).toBe(true);

		const config = getTableConfig(tenantWorkflowCatalog);
		expect(config.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining([
				"uq_tenant_workflow_catalog_slug",
				"idx_tenant_workflow_catalog_tenant_status",
			]),
		);
		expect(config.checks.map((check) => check.name)).toContain(
			"tenant_workflow_catalog_status_enum",
		);
	});

	it("narrows customize catalog migrations to workflows", () => {
		expect(migration0078).toContain("public.tenant_workflow_catalog");
		expect(migration0078).toContain("public.uq_tenant_workflow_catalog_slug");
		expect(migration0078).not.toContain("tenant_connector_catalog");

		expect(migration0079).toContain("baseline_workflows");
		expect(migration0079).toContain("tenant_workflow_catalog");
		expect(migration0079).not.toContain("baseline_connectors");
		expect(migration0079).not.toContain("tenant_connector_catalog");
	});

	it("drops connector objects with drift-detectable markers", () => {
		for (const marker of [
			"public.computer_delegations",
			"public.connector_executions",
			"public.connectors",
			"public.tenant_connector_catalog",
			"public.uq_connector_executions_active_external_ref",
			"public.uq_connectors_tenant_name",
			"public.uq_connectors_catalog_slug_per_computer",
			"public.uq_tenant_connector_catalog_slug",
		]) {
			expect(migration0087).toMatch(
				new RegExp(`--\\s*drops:\\s*${marker.replace(".", "\\.")}\\b`),
			);
		}

		const dropExecutionsOffset = migration0087.indexOf(
			"DROP TABLE IF EXISTS public.connector_executions",
		);
		const dropConnectorsOffset = migration0087.indexOf(
			"DROP TABLE IF EXISTS public.connectors",
		);
		const dropCatalogOffset = migration0087.indexOf(
			"DROP TABLE IF EXISTS public.tenant_connector_catalog",
		);

		expect(dropExecutionsOffset).toBeGreaterThanOrEqual(0);
		expect(dropConnectorsOffset).toBeGreaterThan(dropExecutionsOffset);
		expect(dropCatalogOffset).toBeGreaterThan(dropConnectorsOffset);
	});

	it("restores external refs to the non-tracker source kinds", () => {
		expect(migration0087).toContain(
			"DELETE FROM public.tenant_entity_external_refs",
		);
		expect(migration0087).toContain("'tracker_issue'");
		expect(migration0087).toContain("'tracker_ticket'");
		expect(migration0087).toContain(
			"ADD CONSTRAINT tenant_entity_external_refs_kind_allowed CHECK",
		);

		const restoredConstraint = migration0087.slice(
			migration0087.indexOf(
				"ADD CONSTRAINT tenant_entity_external_refs_kind_allowed CHECK",
			),
		);
		expect(restoredConstraint).not.toContain("'tracker_issue'");
		expect(restoredConstraint).not.toContain("'tracker_ticket'");
		expect(externalRefsSchema).not.toContain("'tracker_issue'");
		expect(externalRefsSchema).not.toContain("'tracker_ticket'");
	});
});
