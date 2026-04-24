import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateToken, hashToken } from "./mcp-admin-keys.js";

describe("mcp-admin-keys token helpers", () => {
	it("generateToken returns tkm_-prefixed base64url with enough entropy", () => {
		const { raw, hash } = generateToken();
		expect(raw.startsWith("tkm_")).toBe(true);
		// 32 bytes → 43-char base64url (no padding). Plus 4-char prefix.
		expect(raw.length).toBe(4 + 43);
		// base64url alphabet: A-Z a-z 0-9 _ -
		expect(raw.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
		// Hash is lowercase hex, 64 chars (SHA-256).
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generateToken produces distinct tokens on repeated calls", () => {
		const a = generateToken();
		const b = generateToken();
		expect(a.raw).not.toBe(b.raw);
		expect(a.hash).not.toBe(b.hash);
	});

	it("hashToken is deterministic SHA-256 hex of the raw string", () => {
		const raw = "tkm_abc123";
		const expected = createHash("sha256").update(raw).digest("hex");
		expect(hashToken(raw)).toBe(expected);
	});

	it("generateToken hash matches hashToken(raw)", () => {
		const { raw, hash } = generateToken();
		expect(hashToken(raw)).toBe(hash);
	});

	it("hashToken is case-sensitive (bytes, not normalized strings)", () => {
		expect(hashToken("Abc")).not.toBe(hashToken("abc"));
	});
});
