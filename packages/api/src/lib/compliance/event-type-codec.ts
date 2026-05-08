/**
 * GraphQL ↔ DB event-type translation.
 *
 * The DB stores dotted-lowercase strings (`auth.signin.success`,
 * `agent.skills_changed`). GraphQL enum values must match
 * `[_A-Za-z][_0-9A-Za-z]*` — no dots allowed. Naive replacement of
 * `.` with `_` is NOT bijective: `agent.skills_changed` and
 * `agent.skills.changed` both map to `AGENT_SKILLS_CHANGED`.
 *
 * Solution: derive the bijective mapping at module-load from
 * `COMPLIANCE_EVENT_TYPES`. Both directions are explicit.
 *
 * The U2 drift snapshot test asserts the GraphQL enum value list in
 * `compliance.graphql` matches the keys this module produces.
 */

import { COMPLIANCE_EVENT_TYPES } from "@thinkwork/database-pg/schema";

function toGqlValue(dbValue: string): string {
	// Replace dots with double-underscores so the reverse mapping is
	// unambiguous. The GraphQL enum value list in compliance.graphql
	// uses single-underscore for readability — we keep the encoding
	// explicit via the lookup tables below to avoid the
	// non-injectivity trap.
	return dbValue.toUpperCase().replace(/\./g, "_");
}

function buildBijectiveMap(): {
	gqlByDb: Map<string, string>;
	dbByGql: Map<string, string>;
} {
	const gqlByDb = new Map<string, string>();
	const dbByGql = new Map<string, string>();
	for (const dbValue of COMPLIANCE_EVENT_TYPES) {
		const gqlValue = toGqlValue(dbValue);
		// Detect ambiguity at module load — if two distinct DB values
		// would collide in GraphQL space, fail loud rather than silently
		// dropping one.
		if (dbByGql.has(gqlValue)) {
			throw new Error(
				`compliance/event-type-codec: GraphQL enum value collision — both '${dbByGql.get(gqlValue)}' and '${dbValue}' map to '${gqlValue}'. Add a discriminator (different word boundary or rename) in COMPLIANCE_EVENT_TYPES.`,
			);
		}
		gqlByDb.set(dbValue, gqlValue);
		dbByGql.set(gqlValue, dbValue);
	}
	return { gqlByDb, dbByGql };
}

const { gqlByDb: GQL_BY_DB, dbByGql: DB_BY_GQL } = buildBijectiveMap();

/** GraphQL enum value (UPPER_UNDERSCORE) → DB string (lower.dotted). */
export function gqlEventTypeToDb(gqlValue: string): string {
	const db = DB_BY_GQL.get(gqlValue);
	if (!db) {
		throw new Error(
			`compliance/event-type-codec: unknown GraphQL ComplianceEventType value '${gqlValue}'`,
		);
	}
	return db;
}

/** DB string (lower.dotted) → GraphQL enum value (UPPER_UNDERSCORE). */
export function dbEventTypeToGql(dbValue: string): string {
	const gql = GQL_BY_DB.get(dbValue);
	if (!gql) {
		throw new Error(
			`compliance/event-type-codec: unknown DB event_type value '${dbValue}'`,
		);
	}
	return gql;
}

/**
 * The full set of GraphQL enum values produced from
 * COMPLIANCE_EVENT_TYPES. The U2 drift test compares this against
 * the literal enum value list in `compliance.graphql` — fails CI
 * if the GraphQL schema and runtime slate disagree.
 */
export function expectedGqlEventTypes(): string[] {
	return Array.from(GQL_BY_DB.values());
}
