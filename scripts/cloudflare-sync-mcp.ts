#!/usr/bin/env tsx
/**
 * cloudflare-sync-mcp — syncs Cloudflare DNS records for the MCP custom
 * domain to match Terraform's outputs.
 *
 * Workflow (run from the repo root):
 *
 *   # 1. First `thinkwork deploy` creates the ACM cert (pending validation).
 *   thinkwork deploy -s prod
 *
 *   # 2. Add the ACM validation CNAME(s) to Cloudflare.
 *   export CLOUDFLARE_API_TOKEN=...
 *   pnpm cf:sync-mcp -- --terraform-dir $THINKWORK_TERRAFORM_DIR
 *
 *   # 3. Wait ~5 min, verify via `aws acm describe-certificate --certificate-arn <arn>`.
 *
 *   # 4. Flip `mcp_custom_domain_ready = true` in terraform.tfvars, deploy again.
 *   thinkwork deploy -s prod
 *
 *   # 5. Add the final mcp.<domain> → API Gateway CNAME.
 *   pnpm cf:sync-mcp -- --terraform-dir $THINKWORK_TERRAFORM_DIR --finalize
 *
 * Reads CLOUDFLARE_API_TOKEN from env; never writes secrets to disk.
 * Idempotent: records are PUT when they exist, POSTed when missing.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
	terraformDir: string;
	finalize: boolean;
	verifyOnly: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		terraformDir: process.env.THINKWORK_TERRAFORM_DIR ?? "",
		finalize: false,
		verifyOnly: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--terraform-dir") args.terraformDir = argv[++i] ?? "";
		else if (a === "--finalize") args.finalize = true;
		else if (a === "--verify-only") args.verifyOnly = true;
		else if (a === "-h" || a === "--help") {
			printHelp();
			process.exit(0);
		}
	}
	return args;
}

function printHelp(): void {
	console.log(`cloudflare-sync-mcp — sync Cloudflare DNS for the MCP custom domain

Usage:
  pnpm cf:sync-mcp -- --terraform-dir <path> [--finalize] [--verify-only]

Options:
  --terraform-dir <path>   Terraform dir with mcp_custom_domain_* outputs
                           (defaults to $THINKWORK_TERRAFORM_DIR).
  --finalize               In addition to syncing ACM validation records, add
                           the final mcp.<domain> → API Gateway CNAME. Only
                           valid after the second terraform apply (when
                           mcp_custom_domain_target output is populated).
  --verify-only            Show what records WOULD be synced without writing.
  -h, --help

Env:
  CLOUDFLARE_API_TOKEN     Required. API token with DNS:Edit on the zone.
`);
}

// ---------------------------------------------------------------------------
// Terraform output
// ---------------------------------------------------------------------------

interface ValidationRecord {
	name: string;
	type: string;
	value: string;
}

interface DomainTarget {
	target_domain_name: string;
	hosted_zone_id: string;
}

interface TerraformOutputs {
	mcp_custom_domain: string;
	mcp_custom_domain_cert_arn: string;
	mcp_custom_domain_validation: ValidationRecord[];
	mcp_custom_domain_target: DomainTarget | null;
}

function readTerraformOutputs(terraformDir: string): TerraformOutputs {
	if (!terraformDir || !existsSync(terraformDir)) {
		console.error(
			`Error: terraform-dir "${terraformDir}" does not exist.\n` +
				"Pass --terraform-dir <path> or set THINKWORK_TERRAFORM_DIR.",
		);
		process.exit(1);
	}

	let raw: string;
	try {
		raw = execSync("terraform output -json", {
			cwd: terraformDir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err) {
		console.error(
			`Error: \`terraform output -json\` failed in ${terraformDir}.\n` +
				"Has terraform been applied at least once for this stage?",
		);
		if (err instanceof Error) console.error(err.message);
		process.exit(1);
	}

	const parsed = JSON.parse(raw) as Record<string, { value: unknown }>;
	const read = <T>(key: string, fallback: T): T =>
		(parsed[key]?.value as T | undefined) ?? fallback;

	return {
		mcp_custom_domain: read<string>("mcp_custom_domain", ""),
		mcp_custom_domain_cert_arn: read<string>("mcp_custom_domain_cert_arn", ""),
		mcp_custom_domain_validation: read<ValidationRecord[]>(
			"mcp_custom_domain_validation",
			[],
		),
		mcp_custom_domain_target: read<DomainTarget | null>(
			"mcp_custom_domain_target",
			null,
		),
	};
}

// ---------------------------------------------------------------------------
// Cloudflare API
// ---------------------------------------------------------------------------

interface CloudflareZone {
	id: string;
	name: string;
}

interface CloudflareRecord {
	id: string;
	name: string;
	type: string;
	content: string;
	ttl: number;
	proxied: boolean;
}

interface CloudflareList<T> {
	success: boolean;
	result: T[];
	errors: Array<{ code: number; message: string }>;
}

interface CloudflareSingle<T> {
	success: boolean;
	result: T;
	errors: Array<{ code: number; message: string }>;
}

const CF_BASE = "https://api.cloudflare.com/client/v4";

async function cf<T>(
	token: string,
	method: "GET" | "POST" | "PUT" | "DELETE",
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${CF_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const json = (await res.json()) as T & { success?: boolean; errors?: Array<{ message: string }> };
	if (!res.ok || (json as { success?: boolean }).success === false) {
		const errs = (json as { errors?: Array<{ message: string }> }).errors ?? [];
		throw new Error(
			`Cloudflare API ${method} ${path} failed: ${res.status} ${
				errs.map((e) => e.message).join(", ") || "(no error detail)"
			}`,
		);
	}
	return json;
}

function rootZoneOf(fqdn: string): string {
	// mcp.thinkwork.ai → thinkwork.ai
	// foo.bar.thinkwork.ai → thinkwork.ai (best-effort; can be overridden)
	const parts = fqdn.split(".");
	if (parts.length < 2) return fqdn;
	return parts.slice(-2).join(".");
}

async function findZoneId(token: string, domain: string): Promise<string> {
	const root = rootZoneOf(domain);
	const listed = await cf<CloudflareList<CloudflareZone>>(
		token,
		"GET",
		`/zones?name=${encodeURIComponent(root)}`,
	);
	const match = listed.result.find((z) => z.name === root);
	if (!match) {
		throw new Error(
			`Cloudflare zone for "${root}" not found. Check the token has access to this zone.`,
		);
	}
	return match.id;
}

interface UpsertPlan {
	action: "create" | "update" | "noop";
	zoneId: string;
	name: string;
	type: string;
	content: string;
	existingId?: string;
	existingContent?: string;
}

async function planUpsert(
	token: string,
	zoneId: string,
	name: string,
	type: string,
	content: string,
): Promise<UpsertPlan> {
	// Normalize CNAME trailing dot — ACM emits with trailing dot, CF stores without.
	const normalizedContent = content.replace(/\.$/, "");
	const normalizedName = name.replace(/\.$/, "");
	const listed = await cf<CloudflareList<CloudflareRecord>>(
		token,
		"GET",
		`/zones/${zoneId}/dns_records?name=${encodeURIComponent(normalizedName)}&type=${type}`,
	);
	const existing = listed.result.find((r) => r.name === normalizedName && r.type === type);
	if (!existing) {
		return {
			action: "create",
			zoneId,
			name: normalizedName,
			type,
			content: normalizedContent,
		};
	}
	if (existing.content === normalizedContent) {
		return {
			action: "noop",
			zoneId,
			name: normalizedName,
			type,
			content: normalizedContent,
			existingId: existing.id,
			existingContent: existing.content,
		};
	}
	return {
		action: "update",
		zoneId,
		name: normalizedName,
		type,
		content: normalizedContent,
		existingId: existing.id,
		existingContent: existing.content,
	};
}

async function applyUpsert(token: string, plan: UpsertPlan): Promise<void> {
	const payload = {
		name: plan.name,
		type: plan.type,
		content: plan.content,
		ttl: 1, // "Automatic" on Cloudflare
		proxied: false, // TLS termination happens at API Gateway; don't proxy
	};
	if (plan.action === "create") {
		await cf<CloudflareSingle<CloudflareRecord>>(
			token,
			"POST",
			`/zones/${plan.zoneId}/dns_records`,
			payload,
		);
	} else if (plan.action === "update") {
		await cf<CloudflareSingle<CloudflareRecord>>(
			token,
			"PUT",
			`/zones/${plan.zoneId}/dns_records/${plan.existingId}`,
			payload,
		);
	}
	// noop: nothing to do
}

function describe(plan: UpsertPlan): string {
	const prefix =
		plan.action === "create" ? "CREATE" : plan.action === "update" ? "UPDATE" : "NOOP  ";
	const tail =
		plan.action === "update"
			? ` (was: ${plan.existingContent})`
			: plan.action === "noop"
				? " (already correct)"
				: "";
	return `  [${prefix}] ${plan.type} ${plan.name} → ${plan.content}${tail}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const token = process.env.CLOUDFLARE_API_TOKEN;

	if (!token) {
		console.error("Error: CLOUDFLARE_API_TOKEN env var is required.");
		console.error(
			"Create a token at https://dash.cloudflare.com/profile/api-tokens with\n" +
				"Zone.DNS:Edit on the thinkwork.ai zone.",
		);
		process.exit(1);
	}

	const outputs = readTerraformOutputs(args.terraformDir);

	if (!outputs.mcp_custom_domain) {
		console.error(
			"Error: mcp_custom_domain output is empty.\n" +
				"Set `mcp_custom_domain = \"mcp.thinkwork.ai\"` in terraform.tfvars and\n" +
				"`thinkwork deploy -s <stage>` before running this script.",
		);
		process.exit(1);
	}

	console.log(`Target domain:  ${outputs.mcp_custom_domain}`);
	console.log(`Cert ARN:       ${outputs.mcp_custom_domain_cert_arn || "(not yet created)"}`);
	console.log(
		`Stage:          ${args.finalize ? "finalize (cert validated, add final CNAME)" : "validation (add ACM CNAME records)"}`,
	);
	console.log(`Mode:           ${args.verifyOnly ? "verify-only" : "apply"}`);
	console.log("");

	const zoneId = await findZoneId(token, outputs.mcp_custom_domain);
	const plans: UpsertPlan[] = [];

	// ACM validation records — always sync. Idempotent.
	for (const v of outputs.mcp_custom_domain_validation) {
		plans.push(await planUpsert(token, zoneId, v.name, v.type, v.value));
	}

	// Final mcp.<domain> → API Gateway CNAME — only after second apply.
	if (args.finalize) {
		if (!outputs.mcp_custom_domain_target) {
			console.error(
				"Error: --finalize requested, but mcp_custom_domain_target output is null.\n" +
					"This means the API Gateway domain hasn't been created yet.\n" +
					"Flip `mcp_custom_domain_ready = true` in terraform.tfvars, run\n" +
					"`thinkwork deploy -s <stage>` again, then re-run this script.",
			);
			process.exit(1);
		}
		plans.push(
			await planUpsert(
				token,
				zoneId,
				outputs.mcp_custom_domain,
				"CNAME",
				outputs.mcp_custom_domain_target.target_domain_name,
			),
		);
	}

	if (plans.length === 0) {
		console.log("No records to sync. Has terraform been applied?");
		return;
	}

	console.log("Plan:");
	for (const p of plans) console.log(describe(p));
	console.log("");

	if (args.verifyOnly) {
		const nonNoop = plans.filter((p) => p.action !== "noop").length;
		console.log(
			`verify-only: ${nonNoop} record(s) would be written. Re-run without --verify-only to apply.`,
		);
		return;
	}

	for (const plan of plans) {
		if (plan.action === "noop") continue;
		await applyUpsert(token, plan);
		console.log(`  ✓ ${plan.action.toUpperCase()} ${plan.type} ${plan.name}`);
	}

	console.log("");
	if (!args.finalize) {
		console.log(
			"Next: wait ~5 min for ACM to validate, then flip mcp_custom_domain_ready=true in terraform.tfvars,\nrun `thinkwork deploy`, and re-run this script with --finalize.",
		);
	} else {
		console.log(
			`Done. Give DNS ~60s to propagate, then try:\n  curl -v -X POST -H 'Authorization: Bearer <tenant-token>' https://${outputs.mcp_custom_domain}/mcp/admin -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
		);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
