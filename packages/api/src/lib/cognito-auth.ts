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
	/**
	 * Three auth classes share the request pipeline:
	 *  - `cognito` — Cognito JWT (admin SPA, mobile, `thinkwork login`).
	 *  - `apikey`  — shared service secret + asserted caller identity. The
	 *    caller declares which user (`x-principal-id`) and/or agent
	 *    (`x-agent-id`) the request acts on behalf of; admin-skill gates
	 *    verify those claims independently. This is the impersonation
	 *    path used by the thinkwork-admin skill.
	 *  - `service` — shared service secret with NO declared user or
	 *    agent. The bearer IS the credential. This is the CLI / Strands
	 *    runtime / scheduled-job back-channel path. Tenant scope comes
	 *    from `x-tenant-id` when present; otherwise it's a tenant-less
	 *    platform call. Admin-only mutations may opt in via
	 *    `requireAdminOrServiceCaller`; mutations that stamp a specific
	 *    user/agent identity onto the row stay Cognito-required so
	 *    services can't ghost-write as a user.
	 */
	authType: "cognito" | "apikey" | "service";
	/**
	 * Agent id asserted by the caller for apikey requests via
	 * `x-agent-id` header. Always null for cognito and service callers.
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
 * Shared shape for the two shared-secret acceptance paths. Both branches
 * authenticate via the service secret; what distinguishes them is whether
 * the caller has declared a user/agent identity to act on behalf of:
 *
 *   - `apikey`  — caller asserted `x-principal-id` and/or `x-agent-id`.
 *     This is the impersonation path (thinkwork-admin skill). Operator-
 *     gated mutations cross-check the asserted identity against the
 *     tenant role table and (for admin-skill ops) the per-agent skill
 *     allowlist.
 *   - `service` — bearer-only. No declared user, no declared agent. The
 *     bearer IS the credential. Used by the CLI, the Strands runtime
 *     calling back via API, and scheduled jobs. Tenant scope arrives via
 *     `x-tenant-id` when present.
 *
 * `x-principal-email` is still surfaced for both branches so operator-
 * gated mutations (updateTenantPolicy, sandbox fixture setup) can match
 * it against their own allowlist (e.g. THINKWORK_PLATFORM_OPERATOR_EMAILS).
 * No email header ⇒ no operator-gated mutation runs.
 */
function apikeyAuthResult(headers: Record<string, string | undefined>): AuthResult {
	const principalId = headers["x-principal-id"] || null;
	const agentId = headers["x-agent-id"] || null;
	const authType: AuthResult["authType"] =
		principalId || agentId ? "apikey" : "service";
	return {
		principalId,
		tenantId: headers["x-tenant-id"] || null,
		email: headers["x-principal-email"] || null,
		authType,
		agentId,
	};
}
