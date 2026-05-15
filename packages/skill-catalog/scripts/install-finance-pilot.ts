#!/usr/bin/env tsx
/**
 * Install the finance-pilot skills into a target tenant's workspace.
 *
 * U7 of docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md.
 *
 * Operator-facing: an operator runs this once to seed a prospect's
 * workspace with the three lifted/authored skills:
 *   - finance-3-statement-model
 *   - finance-audit-xls
 *   - finance-statement-analysis
 *
 * The skills land in the target's agent OR template workspace under
 * `skills/<slug>/SKILL.md` (+ README, LICENSE-NOTES). The skills
 * catalog's `deriveAgentSkills` picks up the SKILL.md on PUT, so the
 * agent gets the new capability without any GraphQL mutation.
 *
 * Usage — Cognito JWT auth (interactive operator):
 *
 *   pnpm tsx packages/skill-catalog/scripts/install-finance-pilot.ts \
 *     --api-url=https://abc.execute-api.us-east-1.amazonaws.com \
 *     --token=<cognito-id-token> \
 *     --agent-id=<agent-uuid>
 *
 * Usage — service-auth (apikey, for CI / scripted activation):
 *
 *   pnpm tsx packages/skill-catalog/scripts/install-finance-pilot.ts \
 *     --api-url=https://abc.execute-api.us-east-1.amazonaws.com \
 *     --api-key=<API_AUTH_SECRET> \
 *     --tenant-id=<tenant-uuid> \
 *     --agent-id=<agent-uuid>
 *
 *   # OR target a template instead of an agent:
 *   pnpm tsx packages/skill-catalog/scripts/install-finance-pilot.ts \
 *     --api-url=... --token=... --template-id=<template-uuid>
 *
 * Get a Cognito token via `thinkwork login -s <stage>` then `thinkwork me`
 * (or copy from the admin web app's auth state). Token expires after
 * 1 hour; re-run with a fresh token if you hit a 401. The apikey path
 * uses the shared API_AUTH_SECRET (Secrets Manager / Lambda env) and
 * does not expire.
 *
 * Re-runs are idempotent — PUTs overwrite the existing file.
 */

import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = resolve(__dirname, "..");

const PILOT_SKILL_SLUGS = [
	"finance-3-statement-model",
	"finance-audit-xls",
	"finance-statement-analysis",
] as const;

interface CliArgs {
	apiUrl: string;
	auth: AuthArgs;
	target: { agentId: string } | { templateId: string };
}

type AuthArgs =
	| { kind: "cognito"; token: string }
	| { kind: "apikey"; apiKey: string; tenantId: string; principalId: string };

function parseArgs(argv: string[]): CliArgs {
	const out: Record<string, string> = {};
	for (const arg of argv) {
		const m = arg.match(/^--([^=]+)=(.+)$/);
		if (m) out[m[1]!] = m[2]!;
	}
	const apiUrl = (out["api-url"] || "").replace(/\/$/, "");
	if (!apiUrl) {
		throw new Error("missing --api-url");
	}
	const token = out["token"] || "";
	const apiKey = out["api-key"] || "";
	const tenantId = out["tenant-id"] || "";
	const principalId = out["principal-id"] || "";
	let auth: AuthArgs;
	if (apiKey) {
		if (!tenantId) {
			throw new Error("--api-key requires --tenant-id (the tenant UUID)");
		}
		auth = {
			kind: "apikey",
			apiKey,
			tenantId,
			// Operator identity for audit. Required for tenant_admin / cognito-path
			// callers; for apikey it surfaces in resolveAuditActor as a "system"
			// actor but x-principal-id is still forwarded for log correlation.
			// Defaults to "operator-install-finance-pilot" if not supplied.
			principalId: principalId || "operator-install-finance-pilot",
		};
	} else if (token) {
		auth = { kind: "cognito", token };
	} else {
		throw new Error(
			"must pass either --token (Cognito JWT) or --api-key + --tenant-id (service-auth)",
		);
	}
	const agentId = out["agent-id"] || "";
	const templateId = out["template-id"] || "";
	if (!agentId && !templateId) {
		throw new Error("must pass exactly one of --agent-id or --template-id");
	}
	if (agentId && templateId) {
		throw new Error("must pass exactly one of --agent-id or --template-id, not both");
	}
	return {
		apiUrl,
		auth,
		target: agentId ? { agentId } : { templateId },
	};
}

interface PutFileInput {
	relPath: string;
	body: string;
}

function authHeaders(args: CliArgs): Record<string, string> {
	if (args.auth.kind === "cognito") {
		return { authorization: `Bearer ${args.auth.token}` };
	}
	// Service-auth path: presents the shared API_AUTH_SECRET + the tenant
	// the operator is acting on behalf of. Apikey callers bypass the
	// tenant-admin role check (workspace-files.ts:1421) but MUST present
	// x-agent-id matching the target agent for identity-field writes —
	// generic SKILL.md PUTs are unconstrained.
	const headers: Record<string, string> = {
		"x-api-key": args.auth.apiKey,
		"x-tenant-id": args.auth.tenantId,
		"x-principal-id": args.auth.principalId,
	};
	if ("agentId" in args.target) {
		headers["x-agent-id"] = args.target.agentId;
	}
	return headers;
}

async function putWorkspaceFile(
	args: CliArgs,
	input: PutFileInput,
): Promise<void> {
	const requestBody: Record<string, unknown> = {
		action: "put",
		path: input.relPath,
		// Handler field is `content`, not `body`. The original draft of this
		// script sent `body: ...` which fails 400 ("path and content are
		// required for put"). Catalog install was never run against dev, so
		// the wire-format mismatch hid in plain sight until activation.
		content: input.body,
		...args.target,
	};
	const res = await fetch(`${args.apiUrl}/api/workspaces/files`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...authHeaders(args),
		},
		body: JSON.stringify(requestBody),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`PUT ${input.relPath} failed: ${res.status} ${text}`);
	}
}

/**
 * Walk one skill's directory and emit the (relPath, body) records for
 * each file we want to install. SKILL.md is required; everything else
 * (README, LICENSE-NOTES, references/) is optional.
 */
async function collectSkillFiles(
	skillSlug: string,
): Promise<Array<{ relPath: string; body: string }>> {
	const skillDir = join(CATALOG_DIR, skillSlug);
	const records: Array<{ relPath: string; body: string }> = [];

	async function walk(absDir: string, relPrefix: string): Promise<void> {
		const entries = await fs.readdir(absDir, { withFileTypes: true });
		for (const entry of entries) {
			const absChild = join(absDir, entry.name);
			const relChild = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				await walk(absChild, relChild);
				continue;
			}
			if (!entry.isFile()) continue;
			// Skip OS junk + lockfiles.
			if (entry.name === ".DS_Store") continue;
			const body = await fs.readFile(absChild, "utf-8");
			records.push({
				relPath: `skills/${skillSlug}/${relChild}`,
				body,
			});
		}
	}

	// Confirm the directory exists + SKILL.md is present before walking.
	const stat = await fs.stat(skillDir).catch(() => null);
	if (!stat?.isDirectory()) {
		throw new Error(`skill directory missing: ${skillDir}`);
	}
	const skillMdStat = await fs.stat(join(skillDir, "SKILL.md")).catch(() => null);
	if (!skillMdStat?.isFile()) {
		throw new Error(`SKILL.md missing for skill: ${skillSlug}`);
	}
	await walk(skillDir, "");
	return records;
}

export async function installFinancePilot(args: CliArgs): Promise<{
	installed: number;
	skipped: number;
}> {
	let installed = 0;
	let skipped = 0;
	for (const slug of PILOT_SKILL_SLUGS) {
		console.log(`\n📦 ${slug}`);
		const records = await collectSkillFiles(slug);
		for (const record of records) {
			try {
				await putWorkspaceFile(args, record);
				console.log(`   ✓ ${record.relPath}`);
				installed += 1;
			} catch (err) {
				console.error(`   ✗ ${record.relPath}: ${(err as Error).message}`);
				throw err;
			}
		}
	}
	return { installed, skipped };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	console.log("Finance pilot installer");
	console.log(`  API: ${args.apiUrl}`);
	console.log(`  Target: ${JSON.stringify(args.target)}`);
	const start = Date.now();
	const summary = await installFinancePilot(args);
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(
		`\n✓ Installed ${summary.installed} files across ${PILOT_SKILL_SLUGS.length} skills in ${elapsed}s`,
	);
}

// Run only when invoked directly (not when imported by tests).
const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	main().catch((err) => {
		console.error("\n✗ install-finance-pilot failed:", err);
		process.exit(1);
	});
}

export { parseArgs, collectSkillFiles, PILOT_SKILL_SLUGS };
