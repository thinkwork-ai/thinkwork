/**
 * Compliance event-type GraphQL ↔ DB drift snapshot.
 *
 * The GraphQL `ComplianceEventType` enum is hand-coded in
 * `packages/database-pg/graphql/types/compliance.graphql`. Without a
 * drift gate, a future writer-side addition to `COMPLIANCE_EVENT_TYPES`
 * (in `packages/database-pg/src/schema/compliance.ts`) would silently
 * outpace the GraphQL schema — the resolver would fail zod-validation
 * on the emitted row's event_type and 500 the entire compliance page.
 *
 * This test snapshot-asserts the GraphQL enum value list matches the
 * round-tripped values from the runtime `COMPLIANCE_EVENT_TYPES`
 * constant. Updating one without the other fails CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPLIANCE_EVENT_TYPES } from "@thinkwork/database-pg/schema";
import {
	dbEventTypeToGql,
	expectedGqlEventTypes,
	gqlEventTypeToDb,
} from "../lib/compliance/event-type-codec.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readGqlSchema(): string {
	const schemaPath = resolve(
		__dirname,
		"../../../database-pg/graphql/types/compliance.graphql",
	);
	return readFileSync(schemaPath, "utf-8");
}

function extractEnumValues(schema: string, enumName: string): string[] {
	const match = schema.match(
		new RegExp(`enum ${enumName}\\s*\\{([^}]+)\\}`, "m"),
	);
	if (!match) {
		throw new Error(`Could not find enum ${enumName} in compliance.graphql`);
	}
	return match[1]
		.split(/[\s,]+/)
		.map((v) => v.trim())
		.filter((v) => v.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(v));
}

describe("ComplianceEventType drift gate", () => {
	it("GraphQL enum values exactly match COMPLIANCE_EVENT_TYPES round-tripped", () => {
		const schema = readGqlSchema();
		const gqlValues = extractEnumValues(schema, "ComplianceEventType");
		const expected = expectedGqlEventTypes();
		expect(gqlValues.sort()).toEqual(expected.slice().sort());
	});

	it("every db value round-trips through gql encoding bijectively", () => {
		for (const dbValue of COMPLIANCE_EVENT_TYPES) {
			const gqlValue = dbEventTypeToGql(dbValue);
			expect(gqlValue).toMatch(/^[A-Z][A-Z0-9_]*$/);
			// Bijective: the explicit lookup tables in the codec return
			// the exact original DB value. A naive `_ → .` reverse
			// would collide on `agent.skills_changed` (which contains
			// both `.` and `_`).
			expect(gqlEventTypeToDb(gqlValue)).toBe(dbValue);
		}
	});
});
