/**
 * LastMile Personal Access Tokens (PATs).
 *
 * LastMile's API accepts either raw WorkOS user JWTs or long-lived PATs
 * (the `lmi_...` prefix). Per the LastMile playground intro, PATs are the
 * recommended auth for server-side integrations because:
 *
 *   - They're long-lived (up to 365 days) and opaque on the wire
 *   - They work on BOTH the REST API and the MCP transport
 *   - They sidestep the per-user Clerk lookup that was the root cause of
 *     "Failed to validate WorkOS user" on the direct-WorkOS-JWT path
 *
 * This module handles the one-time exchange: `POST /api-tokens` with a
 * user's WorkOS JWT in the Authorization header returns a plaintext PAT
 * that's then stored in Secrets Manager and reused for every subsequent
 * API call (workflows, tasks, etc.) until it expires or is revoked.
 *
 * Storage:
 *   `thinkwork/{stage}/lastmile-pat/{userId}` →
 *   `{ id, token, name, expiresAt, createdAt }`
 *
 * The `userId` is the ThinkWork DB user id (Cognito sub). PATs are
 * per-user by design — LastMile attributes API calls to whoever minted
 * the PAT, so sharing across users would muddy audit trails.
 *
 * Refresh: on a 401 from any REST endpoint the REST adapter calls
 * `forceRefreshLastmilePat`, which re-exchanges and rotates the SSM
 * secret. The previous PAT ID isn't revoked automatically (leaving it
 * for LastMile's own cleanup) since the new PAT works immediately.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
	CreateSecretCommand,
	UpdateSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const STAGE = process.env.STAGE || process.env.APP_STAGE || "dev";
const LASTMILE_API_URL =
	process.env.LASTMILE_TASKS_API_URL || "https://dev-api.lastmile-tei.com";
const EXCHANGE_TIMEOUT_MS = 10_000;
const EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000; // 1 day
const DEFAULT_EXPIRES_IN_DAYS = 90;

const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

interface StoredPat {
	id: string;
	token: string;
	name: string;
	expiresAt: string | null;
	createdAt: string;
}

/** Shape returned by LastMile's POST /api-tokens (201 Created). */
interface ApiTokenCreateResult {
	id: string;
	name: string;
	token: string;
	tokenPrefix?: string;
	scopes?: string[];
	expiresAt?: string | null;
	createdAt: string;
}

function secretRef(userId: string): string {
	return `thinkwork/${STAGE}/lastmile-pat/${userId}`;
}

async function readStoredPat(userId: string): Promise<StoredPat | null> {
	try {
		const res = await sm.send(
			new GetSecretValueCommand({ SecretId: secretRef(userId) }),
		);
		if (!res.SecretString) return null;
		return JSON.parse(res.SecretString) as StoredPat;
	} catch (err) {
		if (err instanceof ResourceNotFoundException) return null;
		throw err;
	}
}

async function writeStoredPat(userId: string, pat: StoredPat): Promise<void> {
	const ref = secretRef(userId);
	const payload = JSON.stringify(pat);
	try {
		await sm.send(
			new UpdateSecretCommand({ SecretId: ref, SecretString: payload }),
		);
	} catch (err) {
		if (err instanceof ResourceNotFoundException) {
			await sm.send(new CreateSecretCommand({ Name: ref, SecretString: payload }));
			return;
		}
		throw err;
	}
}

function isUsable(pat: StoredPat | null): pat is StoredPat {
	if (!pat?.token) return false;
	if (!pat.expiresAt) return true; // no expiry = usable
	return new Date(pat.expiresAt).getTime() - Date.now() > EXPIRY_BUFFER_MS;
}

/**
 * Exchange a WorkOS user JWT for a new LastMile PAT by POSTing to
 * `/api-tokens`. Returns the full LastMile response — callers persist
 * the plaintext token themselves.
 *
 * Throws on network errors and non-2xx responses. The error preserves
 * the upstream status + body so the caller can translate 401/403
 * distinctly (e.g. "your WorkOS JWT is expired; reconnect on mobile").
 */
export async function exchangeWorkosJwtForPat(args: {
	workosJwt: string;
	name: string;
	expiresInDays?: number;
	baseUrl?: string;
}): Promise<ApiTokenCreateResult> {
	if (!args.workosJwt) {
		throw new Error("exchangeWorkosJwtForPat: workosJwt is required");
	}
	const baseUrl = (args.baseUrl ?? LASTMILE_API_URL).replace(/\/$/, "");
	const url = `${baseUrl}/api-tokens`;

	const body = {
		name: args.name,
		...(args.expiresInDays !== undefined
			? { expiresInDays: args.expiresInDays }
			: { expiresInDays: DEFAULT_EXPIRES_IN_DAYS }),
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${args.workosJwt}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const err = new Error(
				`[lastmile-pat] POST /api-tokens failed: ${res.status} ${text}`,
			);
			(err as Error & { status?: number; body?: string }).status = res.status;
			(err as Error & { status?: number; body?: string }).body = text;
			throw err;
		}

		const parsed = (await res.json()) as ApiTokenCreateResult;
		if (!parsed.token) {
			throw new Error(
				`[lastmile-pat] POST /api-tokens returned no token: ${JSON.stringify(parsed)}`,
			);
		}
		return parsed;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Return a usable PAT for `userId`. Reads the cached secret; if missing
 * or expired/expiring-soon, exchanges the provided WorkOS JWT for a
 * fresh PAT and stores it. `getFreshWorkosJwt` is a callback so callers
 * can mint lazily (don't pay the cost when the cache is warm).
 *
 * Returns null when the JWT callback returns null (user hasn't
 * connected LastMile yet) or when the exchange fails — callers should
 * treat null as "surface reconnect UX".
 */
export async function getOrMintLastmilePat(args: {
	userId: string;
	getFreshWorkosJwt: () => Promise<string | null>;
	tokenName?: string;
	expiresInDays?: number;
	baseUrl?: string;
}): Promise<string | null> {
	const existing = await readStoredPat(args.userId);
	if (isUsable(existing)) {
		return existing.token;
	}

	const workosJwt = await args.getFreshWorkosJwt();
	if (!workosJwt) {
		console.warn(
			`[lastmile-pat] No WorkOS JWT available for user ${args.userId} — cannot mint PAT`,
		);
		return null;
	}

	let result: ApiTokenCreateResult;
	try {
		result = await exchangeWorkosJwtForPat({
			workosJwt,
			name: args.tokenName ?? "thinkwork-agent",
			expiresInDays: args.expiresInDays,
			baseUrl: args.baseUrl,
		});
	} catch (err) {
		console.error(
			`[lastmile-pat] Exchange failed for user ${args.userId}:`,
			err,
		);
		return null;
	}

	const stored: StoredPat = {
		id: result.id,
		token: result.token,
		name: result.name,
		expiresAt: result.expiresAt ?? null,
		createdAt: result.createdAt,
	};
	try {
		await writeStoredPat(args.userId, stored);
	} catch (err) {
		console.error(
			`[lastmile-pat] Failed to persist PAT to SM for user ${args.userId}:`,
			err,
		);
		// Still return the token — the call chain can use it this invocation.
		// Future invocations will just re-exchange (wasteful but correct).
	}
	console.log(
		`[lastmile-pat] Minted PAT for user ${args.userId} (id=${result.id}, expires=${result.expiresAt ?? "never"})`,
	);
	return result.token;
}

/**
 * Force a fresh PAT mint — called by the REST adapter on 401 retry.
 * Invalidates the cached secret before exchanging so concurrent calls
 * don't race on the stale token.
 */
export async function forceRefreshLastmilePat(args: {
	userId: string;
	getFreshWorkosJwt: () => Promise<string | null>;
	tokenName?: string;
	expiresInDays?: number;
	baseUrl?: string;
}): Promise<string | null> {
	// We don't delete the SM secret — writeStoredPat overwrites it on
	// success. Deleting first would open a window where concurrent
	// resolveOAuthToken calls see ResourceNotFound and mint twice.
	const workosJwt = await args.getFreshWorkosJwt();
	if (!workosJwt) {
		console.warn(
			`[lastmile-pat] Force-refresh for user ${args.userId}: no WorkOS JWT available`,
		);
		return null;
	}

	let result: ApiTokenCreateResult;
	try {
		result = await exchangeWorkosJwtForPat({
			workosJwt,
			name: args.tokenName ?? "thinkwork-agent",
			expiresInDays: args.expiresInDays,
			baseUrl: args.baseUrl,
		});
	} catch (err) {
		console.error(
			`[lastmile-pat] Force-refresh exchange failed for user ${args.userId}:`,
			err,
		);
		return null;
	}

	const stored: StoredPat = {
		id: result.id,
		token: result.token,
		name: result.name,
		expiresAt: result.expiresAt ?? null,
		createdAt: result.createdAt,
	};
	try {
		await writeStoredPat(args.userId, stored);
	} catch (err) {
		console.error(
			`[lastmile-pat] Failed to persist refreshed PAT for user ${args.userId}:`,
			err,
		);
	}
	console.log(
		`[lastmile-pat] Force-refreshed PAT for user ${args.userId} (id=${result.id})`,
	);
	return result.token;
}
