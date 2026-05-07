import { describe, expect, it } from "vitest";
import { COMPLIANCE_EVENT_TYPES } from "@thinkwork/database-pg/schema";
import { redactPayload, sanitizeStringField } from "../redaction";
import { EVENT_PAYLOAD_SHAPES } from "../event-schemas";

describe("redactPayload", () => {
	describe("registry exhaustiveness", () => {
		it.each(COMPLIANCE_EVENT_TYPES)(
			"event type %s has a redaction schema",
			(eventType) => {
				expect(EVENT_PAYLOAD_SHAPES[eventType]).toBeDefined();
			},
		);
	});

	describe("happy path — fields in allow-list pass through", () => {
		it("agent.skills_changed retains agentId + addedSkills + removedSkills", () => {
			const result = redactPayload("agent.skills_changed", {
				agentId: "a1",
				addedSkills: ["s1", "s2"],
				removedSkills: ["s3"],
			});
			expect(result.redacted).toEqual({
				agentId: "a1",
				addedSkills: ["s1", "s2"],
				removedSkills: ["s3"],
			});
			expect(result.redactedFields).toEqual([]);
		});

		it("auth.signin.success retains userId + method + ip + userAgent", () => {
			const result = redactPayload("auth.signin.success", {
				userId: "u1",
				method: "password",
				ip: "10.0.0.1",
				userAgent: "Mozilla/5.0",
			});
			expect(result.redactedFields).toEqual([]);
			expect(result.redacted).toMatchObject({
				userId: "u1",
				method: "password",
				ip: "10.0.0.1",
			});
		});
	});

	describe("allow-list drops disallowed fields", () => {
		it("drops apiKey from agent.skills_changed", () => {
			const result = redactPayload("agent.skills_changed", {
				agentId: "a1",
				addedSkills: ["s1"],
				apiKey: "sk-proj-deadbeef",
			});
			expect(result.redacted).not.toHaveProperty("apiKey");
			expect(result.redactedFields).toContain("apiKey");
		});

		it("drops password from auth.signin.failure even when caller passes it", () => {
			const result = redactPayload("auth.signin.failure", {
				email: "user@example.com",
				method: "password",
				reason: "invalid_credentials",
				password: "p4ssw0rd!",
			});
			expect(result.redacted).not.toHaveProperty("password");
			expect(result.redactedFields).toContain("password");
		});
	});

	describe("secret pattern scrub on allowed fields", () => {
		it("scrubs Authorization Bearer in user-agent string", () => {
			const result = redactPayload("auth.signin.success", {
				userId: "u1",
				method: "password",
				ip: "10.0.0.1",
				userAgent: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
			});
			expect(result.redacted.userAgent).toBe("<REDACTED:secret>");
			expect(result.redactedFields).toContain("userAgent:scrubbed");
		});

		it("scrubs GitHub token prefix", () => {
			const result = redactPayload("user.invited", {
				email: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				role: "member",
				invitedBy: "u-admin",
			});
			expect(result.redacted.email).toBe("<REDACTED:secret>");
			expect(result.redactedFields).toContain("email:scrubbed");
		});
	});

	describe("governance file diff preTransform", () => {
		it("replaces raw content with content_sha256 + 2 KB preview, preserves workspaceId", () => {
			const fakeContent = "x".repeat(10_000);
			const result = redactPayload("workspace.governance_file_edited", {
				file: "AGENTS.md",
				content: fakeContent,
				workspaceId: "w1",
			});
			expect(result.redacted).not.toHaveProperty("content");
			expect(result.redacted.content_sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(result.redacted.preview).toBeDefined();
			// Byte-bounded, not character-bounded.
			expect(
				Buffer.byteLength(result.redacted.preview as string, "utf-8"),
			).toBeLessThanOrEqual(2048);
			// Workspace context must round-trip — auditor needs it to tie
			// the event to a workspace.
			expect(result.redacted.workspaceId).toBe("w1");
			expect(result.redacted.file).toBe("AGENTS.md");
			expect(result.redactedFields).toEqual([]);
		});

		it("preview byte length stays under 2048 even for multi-byte content (emoji/CJK)", () => {
			// 4-byte emoji × 1500 = 6000 bytes; preview must truncate by
			// bytes not by char index, otherwise the limit is violated.
			const longEmoji = "🎉".repeat(1500);
			const result = redactPayload("workspace.governance_file_edited", {
				file: "AGENTS.md",
				content: longEmoji,
				workspaceId: "w1",
			});
			const preview = result.redacted.preview as string;
			expect(Buffer.byteLength(preview, "utf-8")).toBeLessThanOrEqual(2048);
			// Truncation must not produce replacement chars from
			// mid-codepoint cuts.
			expect(preview).not.toContain("�");
		});

		it("scrubs secrets in preview before truncation (no partial-token leak at boundary)", () => {
			// Place a GitHub token within the would-be preview region.
			// If truncation happened first then scrub, a 12-char tail of
			// the token could survive (PREFIXED_TOKEN minimum is 20).
			const filler = "x".repeat(2000);
			const token = "ghp_" + "A".repeat(36);
			const result = redactPayload("workspace.governance_file_edited", {
				file: "AGENTS.md",
				content: filler + token + "trailing",
				workspaceId: "w1",
			});
			const preview = result.redacted.preview as string;
			expect(preview).not.toContain("ghp_");
			expect(preview).toContain("<REDACTED:scrubbed>");
		});

		it("hashes empty content correctly", () => {
			const result = redactPayload("workspace.governance_file_edited", {
				file: "AGENTS.md",
				content: "",
				workspaceId: "w1",
			});
			// sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
			expect(result.redacted.content_sha256).toBe(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			);
			expect(result.redacted.workspaceId).toBe("w1");
		});
	});

	describe("MCP URL userinfo stripping", () => {
		it("strips username and password from mcp.added.url", () => {
			const result = redactPayload("mcp.added", {
				mcpId: "m1",
				url: "https://user:p4ss@mcp.example.com/path",
				scopes: ["read"],
			});
			expect(result.redacted.url).toBe("https://mcp.example.com/path");
		});

		it("leaves URLs without userinfo unchanged", () => {
			const result = redactPayload("mcp.added", {
				mcpId: "m1",
				url: "https://mcp.example.com/path",
			});
			expect(result.redacted.url).toBe("https://mcp.example.com/path");
		});

		it("strips userinfo from mcp.removed.url too", () => {
			const result = redactPayload("mcp.removed", {
				mcpId: "m1",
				url: "https://x:sk-anything@mcp.example.com",
			});
			expect(result.redacted.url).toBe("https://mcp.example.com/");
		});

		it("preserves malformed URLs (graceful pre-transform fallback)", () => {
			const result = redactPayload("mcp.added", {
				mcpId: "m1",
				url: "not a url",
			});
			expect(result.redacted.url).toBe("not a url");
		});

		it("strips credential-shaped query params from mcp.added.url", () => {
			const result = redactPayload("mcp.added", {
				mcpId: "m1",
				url: "https://mcp.example.com/path?api_key=sk-live-abc123&safe=1",
				scopes: ["read"],
			});
			const stripped = result.redacted.url as string;
			expect(stripped).not.toContain("sk-live-abc123");
			expect(stripped).toContain("api_key=%3CREDACTED%3Ascrubbed%3E");
			// Non-credential params survive.
			expect(stripped).toContain("safe=1");
		});

		it("strips token / access_token / client_secret query params", () => {
			const result = redactPayload("mcp.added", {
				mcpId: "m1",
				url: "https://mcp.example.com/?token=abc&access_token=def&client_secret=ghi",
			});
			const stripped = result.redacted.url as string;
			expect(stripped).not.toContain("abc");
			expect(stripped).not.toContain("def");
			expect(stripped).not.toContain("ghi");
		});

		it("strips both userinfo and credential query params in one call", () => {
			const result = redactPayload("mcp.removed", {
				mcpId: "m1",
				url: "https://user:pass@mcp.example.com/?api_key=secret",
			});
			const stripped = result.redacted.url as string;
			expect(stripped).not.toContain("user");
			expect(stripped).not.toContain("pass");
			expect(stripped).not.toContain("secret");
		});
	});

	describe("string sanitization", () => {
		it("truncates strings exceeding 4096 bytes", () => {
			const longString = "a".repeat(5000);
			const result = redactPayload("user.created", {
				userId: "u1",
				email: longString,
				role: "member",
			});
			const emailValue = result.redacted.email as string;
			expect(Buffer.byteLength(emailValue, "utf-8")).toBeLessThanOrEqual(
				4096,
			);
			expect(result.redactedFields).toContain("email:truncated");
		});

		it("strips control chars but preserves \\n and \\t", () => {
			const result = sanitizeStringField("a\x00b\x01c\nd\te\x1Ff");
			expect(result.value).toBe("abc\nd\tef");
			expect(result.truncated).toBe(false);
		});

		it("does not truncate strings within the 4096-byte cap", () => {
			const result = sanitizeStringField("short string");
			expect(result.value).toBe("short string");
			expect(result.truncated).toBe(false);
		});

		it("returns empty string unchanged for empty input", () => {
			const result = sanitizeStringField("");
			expect(result.value).toBe("");
			expect(result.truncated).toBe(false);
		});

		it("does not truncate at exactly the 4096-byte boundary (fence-post check)", () => {
			const exact = "a".repeat(4096);
			const result = sanitizeStringField(exact);
			expect(result.value).toBe(exact);
			expect(result.truncated).toBe(false);
		});

		it("returns empty string when all chars are stripped control chars", () => {
			const result = sanitizeStringField("\x00\x01\x02\x7F\x1F");
			expect(result.value).toBe("");
			expect(result.truncated).toBe(false);
		});

		it("handles multi-byte UTF-8 correctly when truncating", () => {
			// 4-byte emoji × 1500 = 6000 bytes; truncation should land on a
			// codepoint boundary, not mid-byte.
			const longEmoji = "🎉".repeat(1500);
			const result = sanitizeStringField(longEmoji);
			expect(Buffer.byteLength(result.value, "utf-8")).toBeLessThanOrEqual(
				4096,
			);
			// All retained chars are full emoji (no replacement char from
			// mid-codepoint truncation).
			expect(result.value).not.toContain("�");
			expect(result.truncated).toBe(true);
		});
	});

	describe("expanded secret-pattern set", () => {
		it("scrubs AWS access key IDs (AKIA prefix)", () => {
			const result = redactPayload("auth.signin.success", {
				userId: "u1",
				method: "password",
				ip: "10.0.0.1",
				userAgent: "AKIAIOSFODNN7EXAMPLE config",
			});
			expect(result.redacted.userAgent).toBe("<REDACTED:secret>");
			expect(result.redactedFields).toContain("userAgent:scrubbed");
		});

		it("scrubs Anthropic sk-ant- keys", () => {
			const result = redactPayload("user.invited", {
				email: "test@example.com",
				role: "member",
				invitedBy: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			});
			expect(result.redacted.invitedBy).toBe("<REDACTED:secret>");
		});

		it("scrubs OpenAI sk-proj- keys", () => {
			const result = redactPayload("user.invited", {
				email: "test@example.com",
				role: "member",
				invitedBy: "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			});
			expect(result.redacted.invitedBy).toBe("<REDACTED:secret>");
		});

		it("does NOT false-positive on dotted identifiers (16+ char segments)", () => {
			// Pre-fix: this matched the old JWT regex and silently destroyed
			// audit evidence. Post-fix: anchored to `eyJ` prefix, no match.
			const dottedId =
				"date_range_filter_longer.export_format_name_here.tenant_identifier_12";
			const result = redactPayload("data.export_initiated", {
				exportJobId: "j1",
				format: "csv",
				filterSummary: dottedId,
				requestedBy: "u1",
			});
			expect(result.redacted.filterSummary).toBe(dottedId);
			expect(result.redactedFields).not.toContain("filterSummary:scrubbed");
		});

		it("still catches real JWTs (eyJ header prefix)", () => {
			const fakeJwt =
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
			const result = redactPayload("auth.signin.success", {
				userId: "u1",
				method: "password",
				ip: "10.0.0.1",
				userAgent: `Bearer ${fakeJwt}`,
			});
			expect(result.redacted.userAgent).toBe("<REDACTED:secret>");
		});
	});

	describe("error paths", () => {
		it("throws on unknown event type", () => {
			expect(() =>
				redactPayload("nonsense.foo" as never, {}),
			).toThrow(/no redaction schema for event type/);
		});
	});

	describe("Phase 6 reservations (R14) — throw on emit attempt", () => {
		const phase6Types = [
			"policy.evaluated",
			"policy.allowed",
			"policy.blocked",
			"policy.bypassed",
			"approval.recorded",
		] as const;

		it.each(phase6Types)(
			"%s throws — empty allow-list means no defined emit path",
			(eventType) => {
				// Reserved types are declared in COMPLIANCE_EVENT_TYPES so
				// the prefix CHECK constraint accepts them, but emitting
				// before the registry update is a loud failure (better than
				// silently writing {} payloads with no audit evidence).
				expect(() =>
					redactPayload(eventType, { anything: "value" }),
				).toThrow(/Phase 6 reservation/);
			},
		);
	});

	describe("behavioral coverage of remaining Phase 3 starter slate", () => {
		it("auth.signout retains userId + sessionId", () => {
			const result = redactPayload("auth.signout", {
				userId: "u1",
				sessionId: "s1",
				token: "leaked",
			});
			expect(result.redacted).toMatchObject({ userId: "u1", sessionId: "s1" });
			expect(result.redactedFields).toContain("token");
		});

		it("mcp.removed retains mcpId + url", () => {
			const result = redactPayload("mcp.removed", {
				mcpId: "m1",
				url: "https://mcp.example.com",
				token: "leak",
			});
			expect(result.redacted.mcpId).toBe("m1");
			expect(result.redactedFields).toContain("token");
		});

		it("data.export_initiated retains the four allow-list fields", () => {
			const result = redactPayload("data.export_initiated", {
				exportJobId: "j1",
				format: "csv",
				filterSummary: "agent.skills_changed events last 7 days",
				requestedBy: "u-admin",
				password: "leak",
			});
			expect(result.redacted).toMatchObject({
				exportJobId: "j1",
				format: "csv",
				requestedBy: "u-admin",
			});
			expect(result.redactedFields).toContain("password");
		});
	});

	describe("non-string fields pass through unchanged", () => {
		it("preserves array values without sanitization", () => {
			const result = redactPayload("agent.skills_changed", {
				agentId: "a1",
				addedSkills: ["s1", "s2", "s3"],
			});
			expect(result.redacted.addedSkills).toEqual(["s1", "s2", "s3"]);
		});
	});
});
