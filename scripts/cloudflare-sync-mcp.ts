#!/usr/bin/env tsx
/**
 * cloudflare-sync-mcp — syncs Cloudflare DNS records for the MCP custom
 * domain. Two modes of operation:
 *
 *   1) Direct-args mode (preferred — works with CI-driven deploys):
 *      pnpm cf:sync-mcp -- --domain mcp.thinkwork.ai --cert-arn <arn>
 *      pnpm cf:sync-mcp -- --domain mcp.thinkwork.ai --finalize \
 *                          --target <regional-api-gw-domain>
 *
 *      No local terraform state needed. Validation records come from
 *      `aws acm describe-certificate`. Target domain for --finalize is
 *      surfaced by `aws apigatewayv2 get-domain-name`.
 *
 *   2) Terraform-output mode (original — needs local terraform init):
 *      pnpm cf:sync-mcp -- --terraform-dir <path>           # validation
 *      pnpm cf:sync-mcp -- --terraform-dir <path> --finalize
 *
 * Reads CLOUDFLARE_API_TOKEN from env; never writes secrets to disk.
 * Idempotent: records are PUT when they exist and differ, POSTed when
 * missing, and skipped as noop when already correct.
 *
 * Runbook: docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
	// Direct-args mode (preferred)
	domain: string;
	certArn: string;
	target: string;
	region: string;

	// Terraform-output mode
	terraformDir: string;

	// Shared
	finalize: boolean;
	verifyOnly: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		domain: "",
		certArn: "",
		target: "",
		region: process.env.AWS_REGION || "us-east-1",
		terraformDir: process.env.THINKWORK_TERRAFORM_DIR ?? "",
		finalize: false,
		verifyOnly: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--domain") args.domain = argv[++i] ?? "";
		else if (a === "--cert-arn") args.certArn = argv[++i] ?? "";
		else if (a === "--target") args.target = argv[++i] ?? "";
		else if (a === "--region") args.region = argv[++i] ?? args.region;
		else if (a === "--terraform-dir") args.terraformDir = argv[++i] ?? "";
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

Direct-args mode (preferred):
  pnpm cf:sync-mcp -- --domain <fqdn> --cert-arn <arn>                [--verify-only]
  pnpm cf:sync-mcp -- --domain <fqdn> --finalize --target <regional>  [--verify-only]

Terraform-output mode (needs local \`terraform init\` against remote state):
  pnpm cf:sync-mcp -- --terraform-dir <path> [--finalize] [--verify-only]

Options:
  --domain <fqdn>          MCP custom domain (e.g. mcp.thinkwork.ai).
  --cert-arn <arn>         ACM cert ARN. Required in direct-args mode without
                           --finalize. Script fetches DomainValidationOptions
                           via \`aws acm describe-certificate\` and syncs each
                           validation CNAME into Cloudflare.
  --target <regional>      API Gateway regional domain name target (e.g.
                           d-abc123.execute-api.us-east-1.amazonaws.com).
                           Required in direct-args mode with --finalize.
                           Run \`aws apigatewayv2 get-domain-name
                           --domain-name <fqdn>\` to get it.
  --region <region>        AWS region (default: $AWS_REGION or us-east-1).
  --terraform-dir <path>   Terraform dir with mcp_custom_domain_* outputs
                           (defaults to $THINKWORK_TERRAFORM_DIR).
  --finalize               Write the final <domain> -> API Gateway CNAME.
                           Only valid after the API Gateway custom domain
                           exists.
  --verify-only            Show the plan without writing records.
  -h, --help

Env:
  CLOUDFLARE_API_TOKEN     Required. API token with DNS:Edit on the zone.
  AWS_REGION               Used for \`aws acm\` calls in direct-args mode.
`);
}

// ---------------------------------------------------------------------------
// Record sources
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

/**
 * Direct-args record source: shells out to `aws acm describe-certificate`
 * to pull DomainValidationOptions. Uses the AWS CLI (already required by
 * the rest of the deploy stack) instead of adding @aws-sdk/client-acm.
 */
function loadValidationRecordsFromAcm(
	certArn: string,
	region: string,
): ValidationRecord[] {
	let raw: string;
	try {
		raw = execSync(
			`aws acm describe-certificate --region ${region} --certificate-arn "${certArn}" --output json`,
			{ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		);
	} catch (err) {
		console.error(
			`Error: \`aws acm describe-certificate\` failed for ${certArn}.\n` +
				"Check the ARN + that your AWS credentials have acm:DescribeCertificate.",
		);
		if (err instanceof Error) console.error(err.message);
		process.exit(1);
	}

	const parsed = JSON.parse(raw) as {
		Certificate?: {
			DomainValidationOptions?: Array<{
				DomainName: string;
				ValidationMethod: string;
				ResourceRecord?: { Name: string; Type: string; Value: string };
			}>;
		};
	};

	const options = parsed.Certificate?.DomainValidationOptions ?? [];
	const records: ValidationRecord[] = [];
	for (const opt of options) {
		if (opt.ValidationMethod !== "DNS") continue;
		if (!opt.ResourceRecord) {
			// ACM hasn't populated the record yet — usually resolves in
			// a few seconds of cert creation. Surface + bail so the
			// operator can retry rather than syncing an empty plan.
			console.error(
				`Error: ACM hasn't populated ResourceRecord for ${opt.DomainName} yet.\n` +
					"Wait 10-30s after the cert was created, then re-run.",
			);
			process.exit(1);
		}
		records.push({
			name: opt.ResourceRecord.Name,
			type: opt.ResourceRecord.Type,
			value: opt.ResourceRecord.Value,
		});
	}
	return records;
}

/**
 * Terraform-output record source: shells out to `terraform output -json`
 * in a directory already initialized against the right backend.
 */
function loadFromTerraform(terraformDir: string): {
	domain: string;
	certArn: string;
	validation: ValidationRecord[];
	target: DomainTarget | null;
} {
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
		domain: read<string>("mcp_custom_domain", ""),
		certArn: read<string>("mcp_custom_domain_cert_arn", ""),
		validation: read<ValidationRecord[]>("mcp_custom_domain_validation", []),
		target: read<DomainTarget | null>("mcp_custom_domain_target", null),
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
	const json = (await res.json()) as T & {
		success?: boolean;
		errors?: Array<{ message: string }>;
	};
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
	// Normalize CNAME trailing dot — ACM/API Gateway emit with trailing dot, CF stores without.
	const normalizedContent = content.replace(/\.$/, "");
	const normalizedName = name.replace(/\.$/, "");
	const listed = await cf<CloudflareList<CloudflareRecord>>(
		token,
		"GET",
		`/zones/${zoneId}/dns_records?name=${encodeURIComponent(normalizedName)}&type=${type}`,
	);
	const existing = listed.result.find(
		(r) => r.name === normalizedName && r.type === type,
	);
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
		plan.action === "create"
			? "CREATE"
			: plan.action === "update"
				? "UPDATE"
				: "NOOP  ";
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

interface ResolvedInputs {
	domain: string;
	validation: ValidationRecord[];
	finalizeTarget: string;
}

function resolveInputs(args: Args): ResolvedInputs {
	const directArgs = Boolean(args.domain);
	const tfMode = Boolean(args.terraformDir);

	if (!directArgs && !tfMode) {
		console.error(
			"Error: pass either --domain (direct-args mode) or --terraform-dir.\n" +
				"See --help.",
		);
		process.exit(1);
	}
	if (directArgs && tfMode) {
		console.error(
			"Error: --domain and --terraform-dir are mutually exclusive. Pick one mode.",
		);
		process.exit(1);
	}

	if (directArgs) {
		if (!args.finalize) {
			if (!args.certArn) {
				console.error("Error: --cert-arn is required without --finalize.");
				process.exit(1);
			}
			const validation = loadValidationRecordsFromAcm(args.certArn, args.region);
			return { domain: args.domain, validation, finalizeTarget: "" };
		}
		if (!args.target) {
			console.error(
				"Error: --target <regional-api-gw-domain> is required with --finalize.\n" +
					`Run: aws apigatewayv2 get-domain-name --region ${args.region} --domain-name ${args.domain} --query 'DomainNameConfigurations[0].TargetDomainName' --output text`,
			);
			process.exit(1);
		}
		return { domain: args.domain, validation: [], finalizeTarget: args.target };
	}

	// Terraform-output mode
	const tf = loadFromTerraform(args.terraformDir);
	if (!tf.domain) {
		console.error(
			"Error: mcp_custom_domain output is empty.\n" +
				'Set mcp_custom_domain="mcp.thinkwork.ai" (or use --domain) and deploy first.',
		);
		process.exit(1);
	}
	if (args.finalize) {
		if (!tf.target) {
			console.error(
				"Error: --finalize requested, but mcp_custom_domain_target is null.\n" +
					"Set mcp_custom_domain_ready=true and deploy again before finalizing.",
			);
			process.exit(1);
		}
		return {
			domain: tf.domain,
			validation: [],
			finalizeTarget: tf.target.target_domain_name,
		};
	}
	return {
		domain: tf.domain,
		validation: tf.validation,
		finalizeTarget: "",
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const token = process.env.CLOUDFLARE_API_TOKEN;

	if (!token) {
		console.error("Error: CLOUDFLARE_API_TOKEN env var is required.");
		console.error(
			"Create a token at https://dash.cloudflare.com/profile/api-tokens with\n" +
				"Zone.DNS:Edit on the target zone.",
		);
		process.exit(1);
	}

	const { domain, validation, finalizeTarget } = resolveInputs(args);

	console.log(`Target domain:  ${domain}`);
	console.log(
		`Stage:          ${args.finalize ? `finalize (add ${domain} → API Gateway CNAME)` : "validation (add ACM CNAME records)"}`,
	);
	console.log(`Mode:           ${args.verifyOnly ? "verify-only" : "apply"}`);
	console.log("");

	const zoneId = await findZoneId(token, domain);
	const plans: UpsertPlan[] = [];

	for (const v of validation) {
		plans.push(await planUpsert(token, zoneId, v.name, v.type, v.value));
	}
	if (args.finalize && finalizeTarget) {
		plans.push(await planUpsert(token, zoneId, domain, "CNAME", finalizeTarget));
	}

	if (plans.length === 0) {
		console.log("No records to sync.");
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
			`Next: poll ACM until status=ISSUED, then:\n` +
				`  aws apigatewayv2 get-domain-name --domain-name ${domain} --query 'DomainNameConfigurations[0].TargetDomainName' --output text\n` +
				`  pnpm cf:sync-mcp -- --domain ${domain} --finalize --target <target>`,
		);
	} else {
		console.log(
			`Done. Give DNS ~60s to propagate, then:\n` +
				`  curl -v -X POST -H 'Authorization: Bearer <tkm_...>' \\\n` +
				`    https://${domain}/mcp/admin \\\n` +
				`    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
		);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
