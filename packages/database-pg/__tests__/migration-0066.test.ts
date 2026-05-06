import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0066 = readFileSync(
	join(HERE, "..", "drizzle", "0066_extend_external_refs_source_kind.sql"),
	"utf-8",
);
const rollback0066 = readFileSync(
	join(
		HERE,
		"..",
		"drizzle",
		"0066_extend_external_refs_source_kind_rollback.sql",
	),
	"utf-8",
);
const schemaSource = readFileSync(
	join(HERE, "..", "src", "schema", "tenant-entity-external-refs.ts"),
	"utf-8",
);

const extendedSourceKinds = [
	"erp_customer",
	"crm_opportunity",
	"erp_order",
	"crm_person",
	"support_case",
	"bedrock_kb",
	"tracker_issue",
	"tracker_ticket",
] as const;

describe("migration 0066 — tracker external-ref source kinds", () => {
	it("declares the recreated CHECK constraint with the supported marker", () => {
		expect(migration0066).toMatch(
			/--\s*creates-constraint:\s*public\.tenant_entity_external_refs\.tenant_entity_external_refs_kind_allowed_v2\b/,
		);
		expect(migration0066).not.toMatch(/creates-index:/);
	});

	it("uses DROP/ADD constraint so the hardcoded enum can be extended", () => {
		const dropOffset = migration0066.indexOf(
			"DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed",
		);
		const addOffset = migration0066.indexOf(
			"ADD CONSTRAINT tenant_entity_external_refs_kind_allowed_v2 CHECK",
		);

		expect(dropOffset).toBeGreaterThanOrEqual(0);
		expect(addOffset).toBeGreaterThanOrEqual(0);
		expect(dropOffset).toBeLessThan(addOffset);
	});

	it("adds tracker_issue and tracker_ticket without dropping existing values", () => {
		for (const sourceKind of extendedSourceKinds) {
			expect(migration0066).toContain(`'${sourceKind}'`);
			expect(schemaSource).toContain(`'${sourceKind}'`);
		}
	});

	it("rollback restores the prior six-value CHECK and documents cleanup", () => {
		expect(rollback0066).toContain(
			"DELETE FROM public.tenant_entity_external_refs",
		);
		expect(rollback0066).toContain(
			"DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed_v2",
		);
		expect(rollback0066).toContain(
			"ADD CONSTRAINT tenant_entity_external_refs_kind_allowed CHECK",
		);
		expect(rollback0066).toContain("'tracker_issue'");
		expect(rollback0066).toContain("'tracker_ticket'");

		for (const sourceKind of extendedSourceKinds.slice(0, 6)) {
			expect(rollback0066).toContain(`'${sourceKind}'`);
		}
		expect(rollback0066).not.toMatch(/ADD CONSTRAINT[\s\S]*'tracker_issue'/);
		expect(rollback0066).not.toMatch(/ADD CONSTRAINT[\s\S]*'tracker_ticket'/);
	});
});
