/**
 * LastMile M2M (machine-to-machine) token minting.
 *
 * LastMile's REST API accepts two WorkOS token types (see
 * https://dev-playground.lastmile-tei.com for the full spec):
 *
 *   1. **User tokens** — short-lived AuthKit JWTs obtained via the per-user
 *      OAuth flow. These are what the mobile MCP Servers screen stores.
 *      Downside: LastMile's REST side resolves the JWT's `sub` → Clerk user,
 *      and if that lookup fails the request is rejected with "Failed to
 *      validate WorkOS user" even though the token is cryptographically
 *      valid. This is the production error we've been chasing.
 *
 *   2. **M2M tokens** (this module) — long-lived (24h) WorkOS tokens minted
 *      via `client_credentials` against a WorkOS M2M Application. The token
 *      carries an `org_id` claim that LastMile maps to a companyId via the
 *      organization's `metadata.lmi_company_id`. No per-user Clerk lookup
 *      runs — the whole failure mode disappears.
 *
 * This is the correct primitive for agents / CLIs / server-to-server work,
 * which is exactly what our connections handler is (the mobile app never
 * touches LastMile directly — it hits our `/api/connections/...` proxy).
 *
 * Credential storage, in precedence order:
 *
 *   (a) **Per-tenant SSM**: `thinkwork/{stage}/lastmile-m2m/{tenantId}`
 *       with JSON body `{client_id, client_secret}`. Preferred for prod —
 *       lets each tenant bring its own M2M application scoped to its
 *       LastMile org.
 *
 *   (b) **Default SSM**: `thinkwork/{stage}/lastmile-m2m/default`
 *       same shape. Used when the per-tenant secret is absent. Fine for
 *       single-tenant or shared-service setups.
 *
 *   (c) **Env vars**: `LASTMILE_M2M_CLIENT_ID` + `LASTMILE_M2M_CLIENT_SECRET`.
 *       Dev fallback only. Not meant for prod.
 *
 * Token caching:
 *
 * The minted access_token is cached in a module-level Map keyed by the
 * credential identity (client_id), not the tenantId — two tenants sharing
 * one M2M app should share the cache entry. Entries expire
 * `EXPIRY_BUFFER_MS` before the WorkOS-reported `expires_in` so we never
 * hand out a token that's about to die mid-request.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const STAGE = process.env.STAGE || process.env.APP_STAGE || "dev";
const WORKOS_TOKEN_ENDPOINT =
	process.env.WORKOS_TOKEN_ENDPOINT ||
	"https://api.workos.com/user_management/authenticate";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h, per LastMile's spec

const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

interface M2MCredentials {
	client_id: string;
	client_secret: string;
}

interface CachedToken {
	accessToken: string;
	expiresAtMs: number;
}

// Module-level cache. Reset between Lambda cold starts; fine — the token
// lives 24h, and the cache is best-effort to avoid hammering WorkOS.
const tokenCache = new Map<string, CachedToken>();

/**
 * Load M2M credentials for a given tenant, walking the precedence chain.
 * Returns null when nothing is configured — caller should fall back to
 * the per-user WorkOS JWT path or surface a distinct "M2M not configured"
 * error.
 */
async function loadM2MCredentials(
	tenantId: string,
): Promise<M2MCredentials | null> {
	// (a) per-tenant
	const perTenantId = `thinkwork/${STAGE}/lastmile-m2m/${tenantId}`;
	const fromTenant = await readM2MSecret(perTenantId);
	if (fromTenant) return fromTenant;

	// (b) default
	const defaultId = `thinkwork/${STAGE}/lastmile-m2m/default`;
	const fromDefault = await readM2MSecret(defaultId);
	if (fromDefault) return fromDefault;

	// (c) env fallback
	const envId = process.env.LASTMILE_M2M_CLIENT_ID;
	const envSecret = process.env.LASTMILE_M2M_CLIENT_SECRET;
	if (envId && envSecret) {
		return { client_id: envId, client_secret: envSecret };
	}

	return null;
}

async function readM2MSecret(secretId: string): Promise<M2MCredentials | null> {
	try {
		const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
		if (!res.SecretString) return null;
		const parsed = JSON.parse(res.SecretString) as Partial<M2MCredentials>;
		if (!parsed.client_id || !parsed.client_secret) {
			console.warn(
				`[lastmile-m2m] Secret ${secretId} is malformed (missing client_id or client_secret)`,
			);
			return null;
		}
		return { client_id: parsed.client_id, client_secret: parsed.client_secret };
	} catch (err) {
		if (err instanceof ResourceNotFoundException) return null;
		// Other SM errors (IAM, network): log and treat as "not configured"
		// rather than throwing, so the caller can fall through cleanly.
		console.error(`[lastmile-m2m] Error reading ${secretId}:`, err);
		return null;
	}
}

/**
 * Whether any M2M credential source is configured. Used by the
 * connections handler to decide between M2M and the legacy user-JWT path.
 */
export async function isLastmileM2MConfigured(tenantId: string): Promise<boolean> {
	const creds = await loadM2MCredentials(tenantId);
	return creds !== null;
}

/**
 * Mint (or reuse a cached) LastMile M2M access_token for `tenantId`.
 *
 * Returns null when no credentials are configured. Throws on WorkOS
 * errors (invalid_client, network) — the caller translates these to a
 * 502 to make the mis-configuration visible.
 *
 * `forceRefresh: true` bypasses the cache — used by the REST adapter's
 * refresh-on-401 retry path.
 */
export async function mintLastmileM2MToken(
	tenantId: string,
	opts: { forceRefresh?: boolean } = {},
): Promise<string | null> {
	const creds = await loadM2MCredentials(tenantId);
	if (!creds) return null;

	const cacheKey = creds.client_id;
	if (!opts.forceRefresh) {
		const cached = tokenCache.get(cacheKey);
		if (cached && cached.expiresAtMs - Date.now() > EXPIRY_BUFFER_MS) {
			return cached.accessToken;
		}
	}

	const res = await fetch(WORKOS_TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: creds.client_id,
			client_secret: creds.client_secret,
			grant_type: "client_credentials",
		}),
		signal: AbortSignal.timeout(10_000),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(
			`[lastmile-m2m] WorkOS client_credentials failed for client_id=${creds.client_id} (tenant=${tenantId}): ${res.status} ${errText}`,
		);
	}

	const body = (await res.json()) as {
		access_token?: string;
		token_type?: string;
		expires_in?: number;
	};
	if (!body.access_token) {
		throw new Error(
			`[lastmile-m2m] WorkOS returned no access_token for client_id=${creds.client_id}`,
		);
	}

	const lifetimeMs = body.expires_in
		? body.expires_in * 1000
		: DEFAULT_LIFETIME_MS;
	tokenCache.set(cacheKey, {
		accessToken: body.access_token,
		expiresAtMs: Date.now() + lifetimeMs,
	});

	console.log(
		`[lastmile-m2m] Minted M2M token for tenant ${tenantId} (client_id=${creds.client_id}, expires_in=${body.expires_in ?? "?"}s)`,
	);
	return body.access_token;
}

/**
 * Test-only cache reset. Exported so unit tests can isolate cases without
 * module reloads.
 */
export function __resetM2MCacheForTests(): void {
	tokenCache.clear();
}
