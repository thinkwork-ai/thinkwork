/**
 * LastMile webhook HMAC verification.
 *
 * Per-tenant signing: the caller (webhooks.ts task dispatch branch) passes
 * the secret read from `webhooks.config.secret`. When no secret is configured
 * for that tenant's connector, signature verification is skipped — the
 * random 32-byte token in the URL is already the primary auth. The env var
 * `LASTMILE_WEBHOOK_SECRET` remains as a legacy fallback for any call site
 * that hasn't migrated to per-tenant secrets.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET_ENV = "LASTMILE_WEBHOOK_SECRET";

export async function verifyLastmileSignature(req: {
	rawBody: string;
	headers: Record<string, string>;
	secret?: string;
}): Promise<boolean> {
	const secret = req.secret || process.env[WEBHOOK_SECRET_ENV];
	if (!secret) {
		// No per-tenant secret configured AND no env var fallback. Token in URL
		// is the primary auth; signature verification is opt-in. Allow through.
		return true;
	}

	const provided =
		req.headers["x-lastmile-signature"] ||
		req.headers["X-LastMile-Signature"] ||
		"";
	if (!provided) return false;

	const expected = createHmac("sha256", secret).update(req.rawBody).digest("hex");
	const a = Buffer.from(provided.replace(/^sha256=/, ""), "hex");
	const b = Buffer.from(expected, "hex");
	if (a.length !== b.length) return false;

	try {
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}
