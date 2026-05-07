/**
 * Per-event-type payload schemas for the compliance audit-event log.
 *
 * Each entry pairs an `allowedFields` set with an optional `preTransform`
 * that runs before allow-list filtering. Phase 3 starter slate (R10) +
 * Phase 6 reservations (R14) are both represented; reservations have
 * empty allow-lists so any payload they receive is dropped wholesale —
 * loud failure if a Phase 6 emitter ships before its registry update.
 *
 * **Adding a new event type is a deliberate review-time gate.** New
 * `COMPLIANCE_EVENT_TYPES` entries must add an `EVENT_PAYLOAD_SHAPES`
 * entry here; a missing schema causes `redactPayload` to throw at write
 * time. This is the architectural cornerstone of the deny-by-default
 * redaction policy (master plan Decision #6).
 */

import { type ComplianceEventType } from "@thinkwork/database-pg/schema";
import { createHash } from "node:crypto";

export interface RedactionSchema {
	allowedFields: ReadonlySet<string>;
	/**
	 * Optional pre-redaction transform. Runs *before* allow-list filtering
	 * so it can replace structurally-large fields (e.g., raw governance
	 * file content) with hashed/truncated derivatives that the allow-list
	 * then permits.
	 */
	preTransform?: (raw: Record<string, unknown>) => Record<string, unknown>;
}

const GOVERNANCE_PREVIEW_BYTES = 2048;

/**
 * Truncate a string to the largest UTF-8-byte-length-bounded prefix.
 * Bisects on character index so the cut never lands mid-codepoint —
 * `String.slice(0, N)` cuts on JS char count (UTF-16 code units), which
 * for multi-byte content (emoji, CJK) blows past the byte budget. The
 * preview budget (2 KB) is a storage limit, not a character limit, so
 * byte-aware truncation is required.
 */
function sliceByBytes(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		const candidate = text.slice(0, mid);
		if (Buffer.byteLength(candidate, "utf-8") <= maxBytes) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return text.slice(0, lo);
}

/**
 * Replace raw `content` with `content_sha256` + 2 KB byte-bounded
 * `preview` so the audit log records the file diff without storing the
 * full content. Used by `workspace.governance_file_edited` events for
 * AGENTS.md / GUARDRAILS.md / CAPABILITIES.md edits.
 *
 * Order matters: the secret-pattern scrub runs against the FULL content
 * before truncation so a token spanning the 2 KB boundary cannot leak
 * partial key material into the preview. (Avoids the
 * truncate-then-partially-leak bug where 16-char minimum patterns miss
 * 12-char prefix tails.)
 */
function governanceFileDiffTransform(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const content = typeof raw.content === "string" ? raw.content : "";
	// Hash the original (pre-scrub) content so the audit anchor commits
	// to what was actually edited, not the redacted preview.
	const hash = createHash("sha256").update(content, "utf-8").digest("hex");
	// Scrub before truncating so partial tokens can't survive at the boundary.
	const scrubbed = scrubKnownSecretPatterns(content);
	return {
		file: raw.file,
		workspaceId: raw.workspaceId,
		content_sha256: hash,
		preview: sliceByBytes(scrubbed, GOVERNANCE_PREVIEW_BYTES),
	};
}

/**
 * Mirror of the scrub step in `redaction.ts` — kept here in tandem so
 * the `governanceFileDiffTransform` preview is sanitized before
 * truncation. The two pattern sets MUST stay in sync; consider a shared
 * module if the patterns evolve.
 */
const REDACTED = "<REDACTED:scrubbed>";

function scrubKnownSecretPatterns(text: string): string {
	const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;
	const JWT = /\beyJ[A-Za-z0-9_-]{13,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
	const PREFIXED_TOKEN =
		/(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})/g;
	return text
		.replace(AUTH_BEARER, `Authorization: Bearer ${REDACTED}`)
		.replace(JWT, REDACTED)
		.replace(PREFIXED_TOKEN, REDACTED);
}

/**
 * Strip user/password components AND credential-shaped query params
 * from URLs in MCP events. The audit row is durable evidence that
 * outlives the underlying server, so any credential material that
 * survives this transform persists in audit_events permanently.
 *
 * Cleared:
 *   - userinfo (`https://user:pass@host` → `https://host`)
 *   - query params whose name matches a credential heuristic
 *     (case-insensitive substring match against
 *     CREDENTIAL_QUERY_PARAM_NAMES below)
 *
 * `new URL()` gracefully ignores malformed input; on parse failure
 * the original is returned unchanged and the downstream
 * sanitization in `redactPayload` still runs against the string.
 */
const CREDENTIAL_QUERY_PARAM_NAMES = [
	"api_key",
	"apikey",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"id_token",
	"secret",
	"client_secret",
	"password",
	"passwd",
	"auth",
	"signature",
	"sig",
];

function stripUrlUserinfo(value: string): string {
	try {
		const u = new URL(value);
		let mutated = false;
		if (u.username || u.password) {
			u.username = "";
			u.password = "";
			mutated = true;
		}
		// Walk searchParams looking for credential-shaped names. Build
		// the replacement set first to avoid mutating during iteration.
		const toRedact: string[] = [];
		for (const name of u.searchParams.keys()) {
			const lower = name.toLowerCase();
			if (
				CREDENTIAL_QUERY_PARAM_NAMES.some((cred) => lower.includes(cred))
			) {
				toRedact.push(name);
			}
		}
		if (toRedact.length > 0) {
			for (const name of toRedact) {
				u.searchParams.set(name, REDACTED);
			}
			mutated = true;
		}
		if (mutated) return u.toString();
	} catch {
		// not a URL we can parse — leave untouched
	}
	return value;
}

function mcpUrlPreTransform(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...raw };
	if (typeof out.url === "string") {
		out.url = stripUrlUserinfo(out.url);
	}
	return out;
}

/**
 * Allow-list registry. Keys are the 14 entries in `COMPLIANCE_EVENT_TYPES`
 * (10 Phase 3 starter + 5 Phase 6 reservations).
 */
export const EVENT_PAYLOAD_SHAPES: Record<ComplianceEventType, RedactionSchema> =
	{
		// ── Phase 3 starter slate (R10) ───────────────────────────────

		"auth.signin.success": {
			allowedFields: new Set(["userId", "method", "ip", "userAgent"]),
		},
		"auth.signin.failure": {
			// Deliberately exclude `password` / `token` even if a caller
			// passes them — allow-list drops them. `reason` is a coarse
			// enum like `invalid_credentials` / `mfa_required`, not free-text.
			allowedFields: new Set(["email", "method", "reason", "ip"]),
		},
		"auth.signout": {
			allowedFields: new Set(["userId", "sessionId"]),
		},

		"user.invited": {
			allowedFields: new Set(["email", "role", "invitedBy"]),
		},
		"user.created": {
			allowedFields: new Set(["userId", "email", "role"]),
		},
		"user.disabled": {
			allowedFields: new Set(["userId", "reason"]),
		},
		"user.deleted": {
			allowedFields: new Set(["userId", "reason"]),
		},

		"agent.created": {
			allowedFields: new Set(["agentId", "name", "templateId"]),
		},
		"agent.deleted": {
			allowedFields: new Set(["agentId", "reason"]),
		},
		"agent.skills_changed": {
			// Direct evidence of effective-capability change (CC8.1).
			// Delta shape: addedSkills / removedSkills are the slugs that
			// changed; the absolute current/previous skill set can be
			// reconstructed from prior `agent.skills_changed` rows in the
			// chain. This avoids a round-trip to read absolute state at
			// emit time.
			allowedFields: new Set([
				"agentId",
				"addedSkills",
				"removedSkills",
				"reason",
			]),
		},

		"mcp.added": {
			allowedFields: new Set(["mcpId", "url", "scopes"]),
			preTransform: mcpUrlPreTransform,
		},
		"mcp.removed": {
			allowedFields: new Set(["mcpId", "url"]),
			preTransform: mcpUrlPreTransform,
		},

		"workspace.governance_file_edited": {
			// Pre-transform replaces raw `content` with `content_sha256` +
			// 2 KB preview so we don't store full file bodies in the audit
			// log. Allow-list then permits only the transformed shape.
			allowedFields: new Set([
				"file",
				"content_sha256",
				"preview",
				"workspaceId",
			]),
			preTransform: governanceFileDiffTransform,
		},

		"data.export_initiated": {
			allowedFields: new Set([
				"exportJobId",
				"format",
				"filterSummary",
				"requestedBy",
			]),
		},

		// ── Phase 6 reservations (R14) — declared, not emitted ────────

		"policy.evaluated": { allowedFields: new Set() },
		"policy.allowed": { allowedFields: new Set() },
		"policy.blocked": { allowedFields: new Set() },
		"policy.bypassed": { allowedFields: new Set() },
		"approval.recorded": { allowedFields: new Set() },
	};

// Build-time exhaustiveness: the `Record<ComplianceEventType,
// RedactionSchema>` annotation on `EVENT_PAYLOAD_SHAPES` above is the
// single safety gate. Adding a new entry to `COMPLIANCE_EVENT_TYPES`
// without a matching schema key is a TypeScript compile error at the
// declaration site — no runtime check needed.
