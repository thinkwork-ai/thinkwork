import { createHash, createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 10 * 60;

export class McpOAuthStateError extends Error {}

export function signObject<T extends Record<string, unknown>>(
	payload: T,
	secret: string,
	ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
	if (!secret) throw new McpOAuthStateError("signing secret is not configured");
	const now = Math.floor(Date.now() / 1000);
	const body = {
		...payload,
		iat: now,
		exp: now + ttlSeconds,
	};
	const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
	const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
	return `${encoded}.${signature}`;
}

export function verifyObject<T extends Record<string, unknown>>(
	token: string,
	secret: string,
): T {
	if (!secret) throw new McpOAuthStateError("signing secret is not configured");
	const [encoded, signature] = token.split(".");
	if (!encoded || !signature) throw new McpOAuthStateError("invalid signed value");
	const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
	if (!timingSafeEqualString(signature, expected)) {
		throw new McpOAuthStateError("signed value verification failed");
	}
	const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T & {
		exp?: number;
	};
	if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
		throw new McpOAuthStateError("signed value expired");
	}
	return payload;
}

export function sha256Base64Url(input: string): string {
	return createHash("sha256").update(input).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
	if (method !== "S256") return false;
	return sha256Base64Url(verifier) === challenge;
}

export function encodeJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "HS256", typ: "JWT" };
	const body = { ...payload, iat: now, exp: now + ttlSeconds };
	const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
	const encodedBody = Buffer.from(JSON.stringify(body)).toString("base64url");
	const signingInput = `${encodedHeader}.${encodedBody}`;
	const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
	return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> {
	const [header, body, signature] = token.split(".");
	if (!header || !body || !signature) throw new McpOAuthStateError("invalid jwt");
	const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	if (!timingSafeEqualString(signature, expected)) throw new McpOAuthStateError("jwt verification failed");
	const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown> & {
		exp?: number;
	};
	if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
		throw new McpOAuthStateError("jwt expired");
	}
	return payload;
}

function timingSafeEqualString(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}
