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

import {
	COMPLIANCE_EVENT_TYPES,
	type ComplianceEventType,
} from "@thinkwork/database-pg/schema";
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
 * Replace raw `content` with `content_sha256` + 2 KB `preview` so the
 * audit log records the file diff without storing the full content.
 * Used by `workspace.governance_file_edited` events for AGENTS.md /
 * GUARDRAILS.md / CAPABILITIES.md edits.
 */
function governanceFileDiffTransform(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const content = typeof raw.content === "string" ? raw.content : "";
	const hash = createHash("sha256").update(content, "utf-8").digest("hex");
	return {
		file: raw.file,
		content_sha256: hash,
		preview: content.slice(0, GOVERNANCE_PREVIEW_BYTES),
	};
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
			allowedFields: new Set([
				"agentId",
				"skillIds",
				"previousSkillIds",
				"reason",
			]),
		},

		"mcp.added": {
			allowedFields: new Set(["mcpId", "url", "scopes"]),
		},
		"mcp.removed": {
			allowedFields: new Set(["mcpId", "url"]),
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

/**
 * Build-time guarantee that every entry in `COMPLIANCE_EVENT_TYPES` has
 * a redaction schema. Because the Record type above is keyed by
 * `ComplianceEventType`, TypeScript fails the build if an event type is
 * missing — runtime exhaustiveness is implied.
 */
const _exhaustive: readonly ComplianceEventType[] = COMPLIANCE_EVENT_TYPES;
void _exhaustive;
