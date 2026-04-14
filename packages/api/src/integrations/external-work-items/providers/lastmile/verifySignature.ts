/**
 * LastMile webhook HMAC verification.
 *
 * Phase 1 locks the interface; Phase 4 will wire `LASTMILE_WEBHOOK_SECRET` and
 * implement real HMAC-SHA256 comparison using crypto.timingSafeEqual.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET_ENV = "LASTMILE_WEBHOOK_SECRET";

export async function verifyLastmileSignature(req: {
	rawBody: string;
	headers: Record<string, string>;
}): Promise<boolean> {
	const secret = process.env[WEBHOOK_SECRET_ENV];
	if (!secret) {
		console.warn(`[lastmile] ${WEBHOOK_SECRET_ENV} not set — signature verification skipped in dev`);
		return process.env.NODE_ENV !== "production";
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
