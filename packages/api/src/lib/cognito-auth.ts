/**
 * Cognito JWT validation for API Gateway endpoints.
 *
 * Uses aws-jwt-verify to validate ID tokens from Cognito User Pools.
 * Supports both Cognito JWT and API key authentication.
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";
const CLIENT_IDS = (process.env.COGNITO_APP_CLIENT_IDS || "").split(",").filter(Boolean);
const API_KEY = process.env.GRAPHQL_API_KEY || "";

export interface AuthResult {
	principalId: string | null;
	tenantId: string | null;
	email: string | null;
	authType: "cognito" | "apikey";
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
	if (!verifier) {
		verifier = CognitoJwtVerifier.create({
			userPoolId: USER_POOL_ID,
			tokenUse: "id",
			clientId: CLIENT_IDS.length > 0 ? CLIENT_IDS : null,
		});
	}
	return verifier;
}

/**
 * Validate the request and return auth context.
 * Returns null if authentication fails.
 */
export async function authenticate(headers: Record<string, string | undefined>): Promise<AuthResult | null> {
	const authHeader = headers["authorization"] || headers["Authorization"] || "";
	const apiKey = headers["x-api-key"] || "";

	// Try Cognito JWT first
	if (authHeader) {
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
		try {
			const payload = await getVerifier().verify(token);
			return {
				principalId: payload.sub,
				tenantId: (payload as any)["custom:tenant_id"] || null,
				email: (payload as any).email || null,
				authType: "cognito",
			};
		} catch (err) {
			console.warn("[cognito-auth] JWT verification failed:", (err as Error).message);
			// Fall through to API key check
		}
	}

	// Try API key
	if (apiKey && apiKey === API_KEY) {
		return {
			principalId: headers["x-principal-id"] || null,
			tenantId: headers["x-tenant-id"] || null,
			email: null,
			authType: "apikey",
		};
	}

	return null;
}
