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
		it("agent.skills_changed retains agentId + skillIds", () => {
			const result = redactPayload("agent.skills_changed", {
				agentId: "a1",
				skillIds: ["s1", "s2"],
			});
			expect(result.redacted).toEqual({
				agentId: "a1",
				skillIds: ["s1", "s2"],
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
				skillIds: ["s1"],
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
		it("replaces raw content with content_sha256 + 2 KB preview", () => {
			const fakeContent = "x".repeat(10_000);
			const result = redactPayload("workspace.governance_file_edited", {
				file: "AGENTS.md",
				content: fakeContent,
				workspaceId: "w1",
			});
			expect(result.redacted).not.toHaveProperty("content");
			expect(result.redacted.content_sha256).toMatch(/^[a-f0-9]{64}$/);
			expect((result.redacted.preview as string).length).toBe(2048);
			expect(result.redactedFields).toEqual([]);
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

	describe("error paths", () => {
		it("throws on unknown event type", () => {
			expect(() =>
				redactPayload("nonsense.foo" as never, {}),
			).toThrow(/no redaction schema for event type/);
		});
	});

	describe("Phase 6 reservations (R14)", () => {
		const phase6Types = [
			"policy.evaluated",
			"policy.allowed",
			"policy.blocked",
			"policy.bypassed",
			"approval.recorded",
		] as const;

		it.each(phase6Types)(
			"%s has empty allow-list — all payload fields dropped",
			(eventType) => {
				const result = redactPayload(eventType, {
					anything: "value",
					more: 42,
				});
				expect(result.redacted).toEqual({});
				expect(result.redactedFields.sort()).toEqual(["anything", "more"]);
			},
		);
	});

	describe("non-string fields pass through unchanged", () => {
		it("preserves array values without sanitization", () => {
			const result = redactPayload("agent.skills_changed", {
				agentId: "a1",
				skillIds: ["s1", "s2", "s3"],
			});
			expect(result.redacted.skillIds).toEqual(["s1", "s2", "s3"]);
		});
	});
});
