/**
 * Cognito JWT validation for API Gateway endpoints.
 *
 * Uses aws-jwt-verify to validate ID tokens from Cognito User Pools.
 * Supports both Cognito JWT and API key authentication.
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";
const CLIENT_IDS = (process.env.COGNITO_APP_CLIENT_IDS || "").split(",").filter(Boolean);

/**
 * Accepted service-to-service secrets for `x-api-key` auth.
 *
 * `API_AUTH_SECRET` / `THINKWORK_API_SECRET` are the canonical service
 * secret (Secrets Manager; injected into every backend Lambda + the
 * agentcore-runtime container's invoke payload). `GRAPHQL_API_KEY` is the
 * AppSync API key — historically the only value accepted here, kept for
 * backward compatibility.
 *
 * Read lazily so tests can override process.env after module load.
 */
function acceptedApiKeys(): string[] {
	const out: string[] = [];
	for (const name of [
		"API_AUTH_SECRET",
		"THINKWORK_API_SECRET",
		"GRAPHQL_API_KEY",
	]) {
		const v = process.env[name];
		if (v) out.push(v);
	}
	return out;
}

export interface AuthResult {
	principalId: string | null;
	tenantId: string | null;
	email: string | null;
	authType: "cognito" | "apikey";
	/**
	 * Agent id asserted by the caller for service-auth (apikey) requests
	 * via `x-agent-id` header. Always null for cognito JWT callers.
	 * Mutations that allow agent self-edits (e.g., `updateAgent` with
	 * service auth, `updateUserProfile`) compare this against the target
	 * id/pair and reject the request if they don't match — keeps the
	 * blast radius of the shared service key narrow.
	 */
	agentId: string | null;
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
 *
 * Three acceptance paths, in order:
 *   1. Cognito JWT in the Authorization header (admin SPA, mobile, `thinkwork login`).
 *   2. Shared service secret in the `x-api-key` header (canonical service-to-service path).
 *   3. Shared service secret in the Authorization header as a Bearer token (CLI + Strands
 *      container back-compat — they historically send `Authorization: Bearer <secret>`
 *      with no `x-api-key` header).
 */
export async function authenticate(headers: Record<string, string | undefined>): Promise<AuthResult | null> {
	const authHeader = headers["authorization"] || headers["Authorization"] || "";
	const apiKey = headers["x-api-key"] || "";
	const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

	// 1. Cognito JWT in the Authorization header.
	if (authHeader) {
		try {
			const payload = await getVerifier().verify(bearerToken);
			return {
				principalId: payload.sub,
				tenantId: (payload as any)["custom:tenant_id"] || null,
				email: (payload as any).email || null,
				authType: "cognito",
				agentId: null,
			};
		} catch (err) {
			console.warn("[cognito-auth] JWT verification failed:", (err as Error).message);
			// Fall through to apikey checks.
		}
	}

	// 2. API key in the x-api-key header.
	if (apiKey) {
		const accepted = acceptedApiKeys();
		if (accepted.some((k) => k === apiKey)) {
			return apikeyAuthResult(headers);
		}
	}

	// 3. API key sent as Authorization: Bearer <secret> — CLI + Strands container
	// back-compat. Only matches when the bearer string is an accepted apikey
	// value; an expired or malformed JWT falls here but will not match any
	// accepted key and safely returns null.
	if (bearerToken) {
		const accepted = acceptedApiKeys();
		if (accepted.some((k) => k === bearerToken)) {
			return apikeyAuthResult(headers);
		}
	}

	return null;
}

/**
 * Shared shape for the two apikey acceptance paths. Apikey auth has no JWT
 * to pull an email from, but operator-gated mutations (updateTenantPolicy,
 * sandbox fixture setup) still need to know which human is driving the
 * service call. Callers pass `x-principal-email` alongside the key;
 * downstream resolvers check it against their own allowlist (e.g.
 * THINKWORK_PLATFORM_OPERATOR_EMAILS). No email header ⇒ no operator-gated
 * mutation runs.
 */
function apikeyAuthResult(headers: Record<string, string | undefined>): AuthResult {
	return {
		principalId: headers["x-principal-id"] || null,
		tenantId: headers["x-tenant-id"] || null,
		email: headers["x-principal-email"] || null,
		authType: "apikey",
		agentId: headers["x-agent-id"] || null,
	};
}
