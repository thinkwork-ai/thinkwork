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
				agentId: null,
			};
		} catch (err) {
			console.warn("[cognito-auth] JWT verification failed:", (err as Error).message);
			// Fall through to API key check
		}
	}

	// Try API key
	if (apiKey) {
		const accepted = acceptedApiKeys();
		if (accepted.some((k) => k === apiKey)) {
			return {
				principalId: headers["x-principal-id"] || null,
				tenantId: headers["x-tenant-id"] || null,
				// Apikey auth has no JWT to pull an email from, but
				// operator-gated mutations (updateTenantPolicy, sandbox
				// fixture setup) still need to know which human is driving
				// the service call. Callers pass `x-principal-email`
				// alongside the api key; downstream resolvers check it
				// against their own allowlist (e.g.
				// THINKWORK_PLATFORM_OPERATOR_EMAILS). No email header ⇒
				// no operator-gated mutation runs.
				email: headers["x-principal-email"] || null,
				authType: "apikey",
				agentId: headers["x-agent-id"] || null,
			};
		}
	}

	return null;
}
