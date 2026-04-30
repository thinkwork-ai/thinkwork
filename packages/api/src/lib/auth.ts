import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { timingSafeEqual } from "node:crypto";

export interface AuthContext {
	tenantId: string;
	principalType: "user" | "assistant";
	principalId: string;
	userId?: string;
}

/**
 * Extract a Bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(
	event: APIGatewayProxyEventV2,
): string | null {
	const auth = event.headers.authorization || event.headers.Authorization;
	if (!auth?.startsWith("Bearer ")) return null;
	return auth.slice(7);
}

/**
 * Simple API secret validation.
 *
 * Compares the provided token against the `API_AUTH_SECRET` environment
 * variable. This will be replaced with JWT / DB key-hash lookup later.
 */
export function validateApiSecret(token: string): boolean {
	const secret = process.env.API_AUTH_SECRET;
	if (!secret) return false;
	const tokenBytes = Buffer.from(token);
	const secretBytes = Buffer.from(secret);
	return (
		tokenBytes.length === secretBytes.length &&
		timingSafeEqual(tokenBytes, secretBytes)
	);
}
