#!/usr/bin/env npx tsx
/**
 * LastMile OAuth Token Diagnostic
 *
 * End-to-end probe that validates a LastMile bearer token works against
 * LastMile's REST API — the exact call the mobile workflow picker makes.
 *
 * Use this when:
 *   - Mobile shows "Failed to validate WorkOS user" (user-JWT path)
 *   - You need to prove a stored user token is still usable
 *   - You need to see what WorkOS actually issued (aud, iss, exp, scope)
 *   - You need to exchange a WorkOS JWT for a LastMile PAT end-to-end
 *
 * Modes:
 *
 *   (A) Raw token (fastest):
 *       npx tsx scripts/integration/diagnose-lastmile-token.ts \
 *         --token "lmi_dev_..." | "eyJ..."
 *
 *   (B) WorkOS JWT → PAT exchange (recommended):
 *       npx tsx scripts/integration/diagnose-lastmile-token.ts \
 *         --workos-jwt "eyJ..."
 *       Exchanges via POST /api-tokens, then hits /workflows with the
 *       minted PAT. Prints the PAT id (save it!) and full response.
 *
 *   (C) User + tenant (reads stored user-JWT from SM; exercises the
 *       existing per-user MCP OAuth path):
 *       npx tsx scripts/integration/diagnose-lastmile-token.ts \
 *         --tenant-id "<uuid>" --user-id "<cognito-sub>" \
 *         --stage dev
 *       (requires AWS creds for SecretsManager access, just like the
 *       Lambda runtime)
 *
 * Env var consumed when present:
 *   LASTMILE_TASKS_API_URL  — REST base URL (default: https://dev-api.lastmile-tei.com)
 *
 * Exits 0 on 2xx, 1 on any failure. Prints everything relevant for triage
 * (request URL, JWT claims, status, LastMile error body, request id).
 */

import { parseArgs } from "node:util";

const API_URL =
	process.env.LASTMILE_TASKS_API_URL || "https://dev-api.lastmile-tei.com";

// ── Arg parsing ──────────────────────────────────────────────────────────

const { values } = parseArgs({
	options: {
		token: { type: "string" },
		"workos-jwt": { type: "string" },
		"pat-name": { type: "string", default: "diagnose-cli" },
		"pat-expires-days": { type: "string", default: "90" },
		"tenant-id": { type: "string" },
		"user-id": { type: "string" },
		stage: { type: "string", default: "dev" },
		path: { type: "string", default: "/workflows" },
		verbose: { type: "boolean", default: false },
	},
	strict: true,
});

const rawToken = values.token;
const workosJwt = values["workos-jwt"];
const patName = values["pat-name"] ?? "diagnose-cli";
const patExpiresDays = Number(values["pat-expires-days"] ?? 90);
const tenantId = values["tenant-id"];
const userId = values["user-id"];
const stage = values.stage ?? "dev";
const probePath = values.path ?? "/workflows";
const verbose = !!values.verbose;

const workosJwtMode = !!workosJwt;
const userMode = !!(tenantId && userId);

if (!rawToken && !workosJwtMode && !userMode) {
	console.error(
		"Usage: diagnose-lastmile-token.ts (--token <pat-or-jwt> | --workos-jwt <jwt> [--pat-name <label>] [--pat-expires-days <n>] | --tenant-id <uuid> --user-id <sub>) [--stage dev] [--path /workflows]",
	);
	process.exit(2);
}

// ── JWT peek helper ───────────────────────────────────────────────────────

function peekJwt(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length < 2 || !parts[1]) return null;
		const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
	} catch {
		return null;
	}
}

// ── Token resolver (mode B: fetch from SM) ────────────────────────────────

async function resolveFromBackend(args: {
	tenantId: string;
	userId: string;
	stage: string;
}): Promise<string> {
	const { SecretsManagerClient, GetSecretValueCommand } = await import(
		"@aws-sdk/client-secrets-manager"
	);
	const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });

	// We can't easily reach the DB from a raw script without the full
	// api package's db connection, but the SM path is fully deterministic:
	// `thinkwork/{stage}/mcp-tokens/{userId}/{mcpServerId}`. The caller
	// will typically pass the raw --token arg in mode A; mode B is a
	// convenience for operators who can list + pick an SM secret by the
	// stage + user prefix.
	const { ListSecretsCommand } = await import("@aws-sdk/client-secrets-manager");
	const prefix = `thinkwork/${args.stage}/mcp-tokens/${args.userId}/`;
	const list = await sm.send(
		new ListSecretsCommand({
			Filters: [{ Key: "name", Values: [prefix] }],
			MaxResults: 10,
		}),
	);
	const candidates = list.SecretList ?? [];
	if (candidates.length === 0) {
		throw new Error(
			`No SM secrets found with prefix ${prefix}. User may not have completed LastMile OAuth.`,
		);
	}
	if (candidates.length > 1) {
		console.error(
			`[diagnose] Multiple MCP tokens found for user ${args.userId} — picking first. Candidates:`,
			candidates.map((s) => s.Name),
		);
	}
	const first = candidates[0];
	if (!first?.Name) throw new Error("SM secret has no name — corrupt listing");
	const secret = await sm.send(new GetSecretValueCommand({ SecretId: first.Name }));
	if (!secret.SecretString) throw new Error(`SM secret ${first.Name} has no payload`);
	const parsed = JSON.parse(secret.SecretString) as {
		access_token?: string;
		obtained_at?: string;
	};
	if (!parsed.access_token) {
		throw new Error(`SM secret ${first.Name} has no access_token field`);
	}
	console.log(
		`[diagnose] Resolved access_token from SM: ${first.Name} (obtained_at=${parsed.obtained_at})`,
	);
	return parsed.access_token;
}

// ── Main probe ────────────────────────────────────────────────────────────

async function exchangeWorkosJwtForPat(jwt: string): Promise<string> {
	const url = `${API_URL.replace(/\/$/, "")}/api-tokens`;
	console.log(`[diagnose] Exchanging WorkOS JWT for PAT via ${url}`);
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			name: patName,
			expiresInDays: patExpiresDays,
		}),
	});
	const bodyText = await res.text();
	if (!res.ok) {
		throw new Error(
			`/api-tokens rejected (${res.status}): ${bodyText}`,
		);
	}
	const parsed = JSON.parse(bodyText) as {
		id: string;
		name: string;
		token: string;
		tokenPrefix?: string;
		expiresAt?: string | null;
	};
	if (!parsed.token) {
		throw new Error(`/api-tokens returned no token: ${bodyText}`);
	}
	console.log(
		`[diagnose] Minted PAT id=${parsed.id} name=${parsed.name} prefix=${parsed.tokenPrefix ?? parsed.token.slice(0, 14) + "…"} expiresAt=${parsed.expiresAt ?? "never"}`,
	);
	console.log(
		`[diagnose] SAVE THIS PAT (plaintext only shown once): ${parsed.token}`,
	);
	return parsed.token;
}

async function main() {
	let token: string;
	if (rawToken) {
		token = rawToken;
	} else if (workosJwtMode) {
		token = await exchangeWorkosJwtForPat(workosJwt!);
	} else {
		token = await resolveFromBackend({ tenantId: tenantId!, userId: userId!, stage });
	}

	const claims = peekJwt(token);
	const nowSec = Math.floor(Date.now() / 1000);
	console.log("\n== JWT claims (peek, not verified) ==");
	console.log({
		iss: claims?.iss,
		sub: claims?.sub,
		aud: claims?.aud,
		exp: claims?.exp,
		expiresInSec:
			typeof claims?.exp === "number" ? (claims.exp as number) - nowSec : undefined,
		scope: claims?.scope,
	});

	const url = `${API_URL.replace(/\/$/, "")}${probePath}`;
	console.log(`\n== Calling ${url} ==`);
	const startedAt = Date.now();
	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
	const elapsedMs = Date.now() - startedAt;

	const bodyText = await res.text();
	let bodyJson: unknown = undefined;
	try {
		bodyJson = JSON.parse(bodyText);
	} catch {
		// non-JSON body
	}

	console.log(`\n== Response (${elapsedMs}ms) ==`);
	console.log({
		status: res.status,
		requestId: res.headers.get("x-request-id"),
		contentType: res.headers.get("content-type"),
	});
	if (verbose) {
		console.log("Headers:", Object.fromEntries(res.headers.entries()));
	}

	if (res.ok) {
		const items = Array.isArray(bodyJson)
			? bodyJson
			: ((bodyJson as { data?: unknown[] } | null)?.data ?? []);
		const envelope =
			!Array.isArray(bodyJson) && bodyJson && typeof bodyJson === "object"
				? (bodyJson as {
						page?: number;
						pageSize?: number;
						totalCount?: number;
						totalPages?: number;
					})
				: null;
		const len = Array.isArray(items) ? items.length : 0;
		console.log(`\nSUCCESS - ${len} item(s)`);
		if (envelope) {
			console.log(
				`Envelope: page=${envelope.page} pageSize=${envelope.pageSize} totalCount=${envelope.totalCount} totalPages=${envelope.totalPages}`,
			);
		}
		if (Array.isArray(items)) {
			console.log(items.slice(0, 5));
		}
		process.exit(0);
	}

	console.error(`\nFAILED - LastMile rejected the request`);
	console.error("Body:", bodyJson ?? bodyText);
	// Diagnostic hints based on what we saw in LastMile's auth.ts.
	if (
		typeof bodyJson === "object" &&
		bodyJson !== null &&
		(bodyJson as { error?: string }).error === "Failed to validate WorkOS user."
	) {
		console.error(
			"\nHint: this error is thrown by LastMile's auth.ts when the Clerk " +
				"user lookup fails AFTER WorkOS signature validation succeeds. " +
				"The token is cryptographically valid; the Clerk user identified " +
				"by `sub` either doesn't exist in their Clerk instance or the " +
				"Clerk API call failed on their side. Reconnecting on mobile " +
				"creates a fresh session bound to a (hopefully) valid Clerk user.",
		);
	}
	if (typeof claims?.exp === "number" && (claims.exp as number) < nowSec) {
		console.error(
			`\nHint: token is EXPIRED (exp=${claims.exp}, now=${nowSec}). ` +
				`Force-refresh via WorkOS refresh_token, or reconnect on mobile.`,
		);
	}
	process.exit(1);
}

main().catch((err: unknown) => {
	console.error("[diagnose] fatal:", err);
	process.exit(1);
});
