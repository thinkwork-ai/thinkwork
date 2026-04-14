/**
 * Unit tests for LastMile webhook HMAC signature verification.
 *
 * Uses the real `node:crypto` module and drives verification with known
 * input/output pairs. Also covers the dev fallback (no secret → open) and
 * prod strictness.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyLastmileSignature } from "../integrations/external-work-items/providers/lastmile/verifySignature.js";

const SECRET = "whsec_test_secret_abc123";
const BODY = JSON.stringify({ event: "task.updated", data: { task: { id: "t_1" } } });

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyLastmileSignature", () => {
	const originalSecret = process.env.LASTMILE_WEBHOOK_SECRET;
	const originalNodeEnv = process.env.NODE_ENV;

	beforeEach(() => {
		process.env.LASTMILE_WEBHOOK_SECRET = SECRET;
		process.env.NODE_ENV = "test";
	});

	afterEach(() => {
		if (originalSecret === undefined) delete process.env.LASTMILE_WEBHOOK_SECRET;
		else process.env.LASTMILE_WEBHOOK_SECRET = originalSecret;
		if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = originalNodeEnv;
	});

	it("accepts a valid hex signature", async () => {
		const sig = sign(BODY, SECRET);
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": sig },
		});
		expect(ok).toBe(true);
	});

	it("accepts a valid signature with sha256= prefix", async () => {
		const sig = sign(BODY, SECRET);
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": `sha256=${sig}` },
		});
		expect(ok).toBe(true);
	});

	it("rejects a signature computed with a different secret", async () => {
		const sig = sign(BODY, "different_secret");
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": sig },
		});
		expect(ok).toBe(false);
	});

	it("rejects a signature when the body differs by one byte", async () => {
		const sig = sign(BODY, SECRET);
		const ok = await verifyLastmileSignature({
			rawBody: BODY + " ",
			headers: { "x-lastmile-signature": sig },
		});
		expect(ok).toBe(false);
	});

	it("rejects when the signature header is missing", async () => {
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: {},
		});
		expect(ok).toBe(false);
	});

	it("rejects a malformed (non-hex) signature", async () => {
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": "not-hex-value" },
		});
		expect(ok).toBe(false);
	});

	it("rejects when secret length differs from signature length", async () => {
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": "abcd" },
		});
		expect(ok).toBe(false);
	});

	it("falls through when no secret is configured — token in URL is primary auth", async () => {
		// After the /webhooks/{token} unification, signature verification is
		// opt-in. When neither a per-tenant secret nor the env-var fallback is
		// set, verifySignature returns true and the 32-byte random URL token
		// becomes the sole auth. Environment is irrelevant.
		delete process.env.LASTMILE_WEBHOOK_SECRET;
		process.env.NODE_ENV = "production";
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: {},
		});
		expect(ok).toBe(true);
	});

	it("accepts a per-tenant secret passed via req.secret (overrides env var)", async () => {
		const tenantSecret = "whsec_tenant_specific_xyz";
		// Env var points at a different secret — req.secret should win.
		process.env.LASTMILE_WEBHOOK_SECRET = "whsec_env_fallback";
		const sig = sign(BODY, tenantSecret);
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": sig },
			secret: tenantSecret,
		});
		expect(ok).toBe(true);
	});

	it("rejects when a per-tenant secret is present but signature is wrong", async () => {
		const tenantSecret = "whsec_tenant_specific_xyz";
		delete process.env.LASTMILE_WEBHOOK_SECRET;
		const wrongSig = sign(BODY, "different_secret");
		const ok = await verifyLastmileSignature({
			rawBody: BODY,
			headers: { "x-lastmile-signature": wrongSig },
			secret: tenantSecret,
		});
		expect(ok).toBe(false);
	});
});
