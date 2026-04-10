/**
 * Email Reply Token Library (PRD-14)
 *
 * HMAC-SHA256 signed tokens for email reply verification.
 * Tokens are embedded in outbound email headers and verified on inbound.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const EMAIL_HMAC_SECRET = process.env.EMAIL_HMAC_SECRET || "";

export interface TokenPayload {
	agentId: string;
	contextId: string;
	contextType: "thread";
	expiresAt: string; // ISO 8601
	nonce: string;
}

/**
 * Generate a signed reply token for outbound emails.
 * Returns the full token string and its SHA-256 hash (for DB storage).
 */
export function generateReplyToken(opts: {
	agentId: string;
	contextId: string;
	contextType: "thread";
	expiresAt: Date;
}): { token: string; tokenHash: string } {
	const payload: TokenPayload = {
		agentId: opts.agentId,
		contextId: opts.contextId,
		contextType: opts.contextType,
		expiresAt: opts.expiresAt.toISOString(),
		nonce: randomBytes(16).toString("hex"),
	};

	const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", EMAIL_HMAC_SECRET)
		.update(encoded)
		.digest("base64url");

	const token = `${encoded}.${signature}`;
	const tokenHash = createHash("sha256").update(token).digest("hex");

	return { token, tokenHash };
}

/**
 * Verify a reply token's HMAC signature using timing-safe comparison.
 * Returns the decoded payload if valid, null otherwise.
 */
export function verifyReplyToken(token: string): TokenPayload | null {
	const parts = token.split(".");
	if (parts.length !== 2) return null;

	const [encoded, providedSig] = parts;

	const expectedSig = createHmac("sha256", EMAIL_HMAC_SECRET)
		.update(encoded)
		.digest("base64url");

	// Timing-safe comparison
	const sigA = Buffer.from(providedSig, "base64url");
	const sigB = Buffer.from(expectedSig, "base64url");
	if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
		return null;
	}

	try {
		const payload = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf-8"),
		) as TokenPayload;

		// Check expiry
		if (new Date(payload.expiresAt) < new Date()) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

/**
 * Hash a token for fast DB lookup.
 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
