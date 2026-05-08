/**
 * Zod schemas for the wire format the writer emits to S3.
 *
 * Field names mirror the writer's emit code byte-exactly:
 *   - packages/lambda/compliance-anchor.ts:417-426 (slice body)
 *   - packages/lambda/compliance-anchor.ts:447-457 (anchor body)
 *
 * Forward compat (R7): zod's default behavior accepts extra unknown
 * fields; we DON'T call .strict(). A future writer that adds
 * `migration_marker` or similar to the JSON body validates here without
 * modification.
 *
 * Schema version: only `schema_version: 1` is supported by this verifier
 * release. An unknown version raises `SchemaVersionUnsupportedError`,
 * distinct from generic zod ValidationError, so the orchestrator can
 * route it to `schema_drift[]` (vs. `parse_failures[]` for malformed v1).
 *
 * Local regex constants — DO NOT import from `@thinkwork/api`. R3's
 * zero-`@thinkwork/*`-deps rule applies; this package must `npm install`
 * cleanly outside the monorepo.
 */

import { z } from "zod";

export const UUIDV7_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
export const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
export const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Slice body
// ---------------------------------------------------------------------------

export const ProofStepSchema = z.object({
	hash: z.string().regex(SHA256_HEX_RE),
	position: z.enum(["left", "right"]),
});

export const SliceSchemaV1 = z.object({
	schema_version: z.literal(1),
	tenant_id: z.string().regex(UUID_RE),
	latest_event_hash: z.string().regex(SHA256_HEX_RE),
	latest_recorded_at: z.string().regex(ISO8601_RE),
	latest_event_id: z.string(),
	leaf_hash: z.string().regex(SHA256_HEX_RE),
	proof_path: z.array(ProofStepSchema),
	global_root: z.string().regex(SHA256_HEX_RE),
	cadence_id: z.string(),
});

export type SliceV1 = z.infer<typeof SliceSchemaV1>;

// ---------------------------------------------------------------------------
// Anchor body
// ---------------------------------------------------------------------------

export const RecordedAtRangeSchema = z.union([
	z.null(),
	z.object({
		min: z.string().regex(ISO8601_RE),
		max: z.string().regex(ISO8601_RE),
	}),
]);

export const AnchorSchemaV1 = z.object({
	schema_version: z.literal(1),
	cadence_id: z.string().regex(UUIDV7_RE),
	recorded_at: z.string().regex(ISO8601_RE),
	merkle_root: z.string().regex(SHA256_HEX_RE),
	tenant_count: z.number().int().nonnegative(),
	anchored_event_count: z.number().int().nonnegative(),
	recorded_at_range: RecordedAtRangeSchema,
	leaf_algorithm: z.literal("sha256_rfc6962"),
	proof_keys: z.array(z.string()),
});

export type AnchorV1 = z.infer<typeof AnchorSchemaV1>;

// ---------------------------------------------------------------------------
// Discriminated parsers
// ---------------------------------------------------------------------------

/**
 * Raised when a JSON body has a `schema_version` we don't recognize.
 * Distinct from zod ValidationError so the orchestrator can route it
 * to `schema_drift[]` (a "newer writer is out there" signal) rather
 * than `parse_failures[]` (a single corrupt body).
 */
export class SchemaVersionUnsupportedError extends Error {
	readonly version: unknown;
	readonly key: string | undefined;
	constructor(version: unknown, key?: string) {
		super(
			`audit-verifier/schema: unsupported schema_version: ${JSON.stringify(version)}` +
				(key ? ` (key: ${key})` : ""),
		);
		this.name = "SchemaVersionUnsupportedError";
		this.version = version;
		this.key = key;
	}
}

/** Lift schema_version to the top so unknown-version errors fire FIRST. */
function getSchemaVersion(value: unknown): unknown {
	if (typeof value === "object" && value !== null && "schema_version" in value) {
		return (value as { schema_version: unknown }).schema_version;
	}
	return undefined;
}

export function parseAnchor(json: unknown, key?: string): AnchorV1 {
	const version = getSchemaVersion(json);
	if (version !== 1) {
		throw new SchemaVersionUnsupportedError(version, key);
	}
	return AnchorSchemaV1.parse(json);
}

export function parseSlice(json: unknown, key?: string): SliceV1 {
	const version = getSchemaVersion(json);
	if (version !== 1) {
		throw new SchemaVersionUnsupportedError(version, key);
	}
	return SliceSchemaV1.parse(json);
}
