#!/usr/bin/env npx tsx
/**
 * LastMile MCP bearer-acceptance probe.
 *
 * Companion to diagnose-lastmile-token.ts (which probes REST). This one
 * POSTs `tools/call` with `tasks_get` to the live MCP endpoint using the
 * provided bearer and reports exactly what LastMile's MCP server replies
 * with — status, raw body, and an interpretation.
 *
 * Why: REST endpoints (/workflows, /tasks, /api-tokens) happily accept
 * PATs (`lmi_...`) *and* WorkOS user JWTs. The MCP transport has been
 * observed to return `{"error":"Failed to validate WorkOS user."}` with
 * HTTP 401 even when the bearer is a freshly-minted PAT that the REST
 * endpoint just accepted. This script isolates that ambiguity.
 *
 * Modes:
 *
 *   (A) Raw bearer (PAT or WorkOS JWT):
 *       npx tsx scripts/integration/diagnose-lastmile-mcp.ts \
 *         --token "lmi_dev_..." | "eyJ..." \
 *         --task-id task_abc123
 *
 *   (B) Mint a fresh PAT from a WorkOS JWT, then probe with it:
 *       npx tsx scripts/integration/diagnose-lastmile-mcp.ts \
 *         --workos-jwt "eyJ..." --task-id task_abc123
 *
 *   (C) Probe both the WorkOS JWT AND a freshly-minted PAT back-to-back
 *       so you can compare the two responses in one run:
 *       npx tsx scripts/integration/diagnose-lastmile-mcp.ts \
 *         --workos-jwt "eyJ..." --task-id task_abc123 --both
 *
 * Env vars consumed when present:
 *   LASTMILE_MCP_BASE_URL   — MCP base (default: https://mcp-dev.lastmile-tei.com)
 *   LASTMILE_TASKS_API_URL  — REST base for PAT exchange (default: https://dev-api.lastmile-tei.com)
 *
 * Exits 0 when a probe succeeds (2xx + no tool error), 1 otherwise. In
 * --both mode, exits 0 only if BOTH probes succeed.
 */

import { parseArgs } from "node:util";

const MCP_BASE = (
	process.env.LASTMILE_MCP_BASE_URL || "https://mcp-dev.lastmile-tei.com"
).replace(/\/$/, "");
const REST_BASE = (
	process.env.LASTMILE_TASKS_API_URL || "https://dev-api.lastmile-tei.com"
).replace(/\/$/, "");
const MCP_SERVER_SEGMENT = "tasks"; // tool namespace: tasks_get etc live here

const { values } = parseArgs({
	options: {
		token: { type: "string" },
		"workos-jwt": { type: "string" },
		"task-id": { type: "string" },
		tool: { type: "string", default: "tasks_get" },
		both: { type: "boolean", default: false },
		"pat-name": { type: "string", default: "diagnose-mcp-cli" },
		verbose: { type: "boolean", default: false },
	},
	strict: true,
});

const rawToken = values.token;
const workosJwt = values["workos-jwt"];
const taskId = values["task-id"];
const toolName = values.tool ?? "tasks_get";
const both = !!values.both;
const patName = values["pat-name"] ?? "diagnose-mcp-cli";
const verbose = !!values.verbose;

if (!taskId) {
	console.error(
		"--task-id is required (any real task id; the probe expects tasks_get to either succeed or return a tool-level 'not found' error, not an auth error)",
	);
	process.exit(2);
}
if (!rawToken && !workosJwt) {
	console.error(
		"Provide --token <bearer> OR --workos-jwt <jwt> (optionally with --both)",
	);
	process.exit(2);
}
if (both && !workosJwt) {
	console.error("--both requires --workos-jwt (so we can mint the PAT)");
	process.exit(2);
}

function classifyToken(bearer: string): "pat" | "workos_jwt" | "unknown" {
	if (bearer.startsWith("lmi_")) return "pat";
	if (bearer.split(".").length === 3) return "workos_jwt";
	return "unknown";
}

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

async function exchangeWorkosJwtForPat(jwt: string): Promise<string> {
	const url = `${REST_BASE}/api-tokens`;
	console.log(`[probe] Minting PAT via ${url}`);
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ name: patName, expiresInDays: 7 }),
	});
	const bodyText = await res.text();
	if (!res.ok) {
		throw new Error(`POST /api-tokens ${res.status}: ${bodyText}`);
	}
	const parsed = JSON.parse(bodyText) as {
		id: string;
		token: string;
		tokenPrefix?: string;
		expiresAt?: string | null;
	};
	console.log(
		`[probe] PAT minted: id=${parsed.id} prefix=${parsed.tokenPrefix ?? parsed.token.slice(0, 14)} expiresAt=${parsed.expiresAt ?? "never"}`,
	);
	return parsed.token;
}

type ProbeResult = {
	kind: "pat" | "workos_jwt" | "unknown";
	status: number;
	body: unknown;
	rawBody: string;
	verdict:
		| "auth_rejected"
		| "tool_error"
		| "tool_ok"
		| "transport_error"
		| "non_json";
	interpretation: string;
};

async function probe(bearer: string, label: string): Promise<ProbeResult> {
	const url = `${MCP_BASE}/${MCP_SERVER_SEGMENT}`;
	const kind = classifyToken(bearer);
	const preview =
		bearer.length > 14
			? `${bearer.slice(0, 12)}…${bearer.slice(-4)}(len=${bearer.length})`
			: `(len=${bearer.length})`;
	console.log(`\n── Probe [${label}] ──`);
	console.log(`kind=${kind} preview=${preview}`);
	if (kind === "workos_jwt") {
		const claims = peekJwt(bearer);
		const nowSec = Math.floor(Date.now() / 1000);
		console.log(
			`claims: iss=${claims?.iss} sub=${claims?.sub} aud=${JSON.stringify(claims?.aud)} exp=${claims?.exp} expiresInSec=${typeof claims?.exp === "number" ? (claims.exp as number) - nowSec : "?"}`,
		);
	}

	const body = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: toolName, arguments: { task_id: taskId } },
	});

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${bearer}`,
		},
		body,
	});

	const rawBody = await res.text();
	let parsed: unknown = undefined;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		/* ignore */
	}

	const haystack = rawBody.toLowerCase();
	const authRejected =
		res.status === 401 ||
		res.status === 403 ||
		haystack.includes("failed to validate workos") ||
		haystack.includes("invalid workos token");

	let verdict: ProbeResult["verdict"];
	let interpretation: string;
	if (authRejected) {
		verdict = "auth_rejected";
		interpretation =
			"MCP rejected the bearer at the auth layer — the same failure mode a stale/invalid WorkOS JWT produces. If this happened with a fresh PAT, MCP does NOT accept PATs (or rejects our PAT format).";
	} else if (!parsed) {
		verdict = "non_json";
		interpretation = `MCP returned a non-JSON body at HTTP ${res.status}.`;
	} else if ((parsed as { error?: unknown }).error) {
		const e = (parsed as { error: { message?: string; code?: number } }).error;
		verdict = "transport_error";
		interpretation = `JSON-RPC transport error code=${e.code ?? "?"} message=${e.message ?? "?"}`;
	} else if (
		(parsed as { result?: { isError?: boolean } }).result?.isError === true
	) {
		verdict = "tool_error";
		const first = (
			parsed as {
				result: { content?: Array<{ text?: string }> };
			}
		).result.content?.[0];
		interpretation = `Tool ran but returned isError=true. Text: ${first?.text ?? "(none)"}. Bearer was accepted at auth — this is a business-logic failure (e.g. task not found).`;
	} else {
		verdict = "tool_ok";
		interpretation =
			"Bearer accepted, tool executed successfully. This bearer type WORKS on MCP.";
	}

	console.log(`status=${res.status} verdict=${verdict}`);
	console.log(`interpretation: ${interpretation}`);
	if (verbose || verdict === "auth_rejected") {
		console.log(`body: ${rawBody.slice(0, 600)}`);
	}

	return { kind, status: res.status, body: parsed, rawBody, verdict, interpretation };
}

async function main() {
	const results: Array<{ label: string; r: ProbeResult }> = [];

	if (both) {
		const jwtResult = await probe(workosJwt!, "WorkOS JWT");
		results.push({ label: "WorkOS JWT", r: jwtResult });
		const pat = await exchangeWorkosJwtForPat(workosJwt!);
		const patResult = await probe(pat, "PAT (minted from JWT)");
		results.push({ label: "PAT", r: patResult });
	} else if (rawToken) {
		results.push({ label: "raw --token", r: await probe(rawToken, "raw") });
	} else {
		const pat = await exchangeWorkosJwtForPat(workosJwt!);
		results.push({
			label: "PAT (minted from JWT)",
			r: await probe(pat, "PAT (minted from JWT)"),
		});
	}

	console.log("\n── Summary ──");
	for (const { label, r } of results) {
		console.log(`${label}: kind=${r.kind} status=${r.status} verdict=${r.verdict}`);
	}

	const allOk = results.every(({ r }) => r.verdict === "tool_ok" || r.verdict === "tool_error");
	if (both) {
		const jwtOk =
			results.find((x) => x.r.kind === "workos_jwt")?.r.verdict !== "auth_rejected";
		const patOk = results.find((x) => x.r.kind === "pat")?.r.verdict !== "auth_rejected";
		console.log(
			`\nConclusion: MCP ${jwtOk ? "ACCEPTS" : "REJECTS"} WorkOS JWT, ${patOk ? "ACCEPTS" : "REJECTS"} PAT.`,
		);
	}
	process.exit(allOk ? 0 : 1);
}

main().catch((err: unknown) => {
	console.error("[probe] unhandled error:", (err as Error)?.stack || err);
	process.exit(1);
});
