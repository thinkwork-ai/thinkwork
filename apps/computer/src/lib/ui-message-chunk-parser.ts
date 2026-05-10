/**
 * Parses one `ComputerThreadChunkEvent.chunk` (AWSJSON, i.e. a
 * JSON-serialized string) into a `UIMessageChunk` per the AI SDK Stream
 * Protocol, with shape-based legacy detection for pre-typed
 * `appsync_publisher` envelopes and non-Computer agent traffic that may
 * arrive on a Computer subscription.
 *
 * Contract: docs/specs/computer-ai-elements-contract-v1.md
 *
 * Legacy detection is shape-based, NOT id-based:
 *   - Legacy is { type: not-a-string, text: string } or { text: string } with
 *     no `type` field.
 *   - Anything with a known protocol `type` value is dispatched by `type`,
 *     even when no `id` is present (`start`, `finish`, `start-step`,
 *     `finish-step`, `abort`, `error`, `tool-input-*`, `tool-output-*`,
 *     `source-*`, `file`, `data-*`, `message-metadata`).
 *
 * The parser never throws on malformed input. Drops surface as
 * `{kind: "drop", reason}` so the transport adapter can log and continue.
 */

import type {
	LegacyTextChunk,
	ParsedChunk,
	UIMessageChunk,
} from "./ui-message-types";

/**
 * Wire-format chunk types that legitimately carry no `id` field. Maintained
 * here as a single source of truth so the parser does not silently demote
 * them to legacy if `id` is absent.
 */
const ID_OPTIONAL_PROTOCOL_TYPES = new Set([
	"start",
	"start-step",
	"finish",
	"finish-step",
	"abort",
	"error",
	"tool-input-start",
	"tool-input-delta",
	"tool-input-available",
	"tool-input-error",
	"tool-output-available",
	"tool-output-error",
	"source-url",
	"source-document",
	"file",
	"message-metadata",
]);

/**
 * Wire-format chunk types that carry a stable per-part `id` and feed the
 * per-part-id append cursor on the consumer side.
 */
const ID_REQUIRED_PROTOCOL_TYPES = new Set([
	"text-start",
	"text-delta",
	"text-end",
	"reasoning-start",
	"reasoning-delta",
	"reasoning-end",
]);

const KNOWN_PROTOCOL_TYPES = new Set<string>([
	...ID_OPTIONAL_PROTOCOL_TYPES,
	...ID_REQUIRED_PROTOCOL_TYPES,
]);

const DATA_PART_PREFIX = "data-";

/**
 * Parse one AppSync `chunk: AWSJSON` payload.
 *
 * Accepts the AWSJSON-as-string shape AppSync emits, the already-parsed
 * object shape (some test fixtures and the urql cache deliver this), and
 * `null`/`undefined` (no-op).
 */
export function parseChunkPayload(raw: unknown): ParsedChunk {
	if (raw == null) {
		return { kind: "drop", reason: "EMPTY", raw };
	}

	let value: unknown = raw;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			return { kind: "drop", reason: "EMPTY", raw };
		}
		try {
			value = JSON.parse(trimmed);
		} catch {
			return { kind: "drop", reason: "INVALID_JSON", raw };
		}
	}

	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return { kind: "drop", reason: "NOT_OBJECT", raw };
	}

	const obj = value as Record<string, unknown>;
	const type = obj.type;

	// Shape-based legacy detection. Legacy envelopes are exactly:
	//   { text: string }                       — no `type` field
	//   { type: <not a string>, text: string } — `type` present but malformed
	// Anything with a string `type` is treated as protocol traffic.
	if (typeof type !== "string") {
		if (typeof obj.text === "string") {
			return {
				kind: "legacy",
				chunk: { text: obj.text } as LegacyTextChunk,
			};
		}
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	if (
		!KNOWN_PROTOCOL_TYPES.has(type) &&
		!type.startsWith(DATA_PART_PREFIX)
	) {
		return { kind: "drop", reason: "UNKNOWN_TYPE", raw };
	}

	if (ID_REQUIRED_PROTOCOL_TYPES.has(type) && typeof obj.id !== "string") {
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	if (
		(type === "tool-input-start" ||
			type === "tool-input-delta" ||
			type === "tool-input-available" ||
			type === "tool-input-error" ||
			type === "tool-output-available" ||
			type === "tool-output-error") &&
		typeof obj.toolCallId !== "string"
	) {
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	if (
		(type === "tool-input-available" ||
			type === "tool-input-start" ||
			type === "tool-input-error") &&
		typeof obj.toolName !== "string"
	) {
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	if (
		(type === "text-delta" || type === "reasoning-delta") &&
		typeof obj.delta !== "string"
	) {
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	if (type === "error" && typeof obj.errorText !== "string") {
		return { kind: "drop", reason: "MALFORMED_PROTOCOL_FIELDS", raw };
	}

	// Pass through with the original object as the chunk payload. Validation
	// of provider-specific optional fields (e.g. `providerMetadata`,
	// `dynamic`, `preliminary`) is deferred to consumers that need them — we
	// don't drop on extra optional fields.
	return { kind: "protocol", chunk: obj as unknown as UIMessageChunk };
}

/**
 * For testing and smoke pinning. Exposed as a stable internal hook the
 * transport-adapter test can grep for to assert protocol coverage stays in
 * sync with the contract spec.
 */
export const __PROTOCOL_TYPE_SETS = {
	ID_REQUIRED: ID_REQUIRED_PROTOCOL_TYPES,
	ID_OPTIONAL: ID_OPTIONAL_PROTOCOL_TYPES,
	KNOWN: KNOWN_PROTOCOL_TYPES,
	DATA_PART_PREFIX,
};
