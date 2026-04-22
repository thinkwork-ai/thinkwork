/**
 * agentPinStatus query (Unit 9).
 *
 * Returns per-pinned-file comparison for one agent:
 *   { filename, pinnedSha, latestSha, updateAvailable,
 *     pinnedContent, latestContent }
 *
 * The UI uses `updateAvailable` to render the "Template update available"
 * badge on the tree, and uses `pinnedContent` + `latestContent` to
 * populate the side-by-side diff in the Accept Template Update dialog —
 * one round-trip for both use cases.
 *
 * Tenant isolation: caller must be able to read the agent (we surface
 * NOT_FOUND for cross-tenant lookups rather than FORBIDDEN, matching the
 * composer's behavior). Admin role is NOT required — any authenticated
 * tenant member should be able to inspect pin status; only the
 * acceptance mutation requires admin.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	agents,
	agentTemplates,
	db,
	eq,
	tenants,
} from "../../utils.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";
import {
	computeSha256,
	readTemplateBaseWithFallback,
} from "../../../lib/pinned-versions.js";
import {
	GetObjectCommand,
	NoSuchKey,
	S3Client,
} from "@aws-sdk/client-s3";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

function versionKey(
	tenantSlug: string,
	templateSlug: string,
	path: string,
	sha: string,
): string {
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace-versions/${path}@sha256:${sha}`;
}

async function readVersionStore(
	tenantSlug: string,
	templateSlug: string,
	path: string,
	sha: string,
): Promise<string | null> {
	const bkt = bucket();
	if (!bkt) return null;
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bkt,
				Key: versionKey(tenantSlug, templateSlug, path, sha),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (err instanceof NoSuchKey) return null;
		const name = (err as { name?: string } | null)?.name;
		if (name === "NoSuchKey") return null;
		throw err;
	}
}

function extractHex(pin: string | null | undefined): string | null {
	if (!pin) return null;
	return pin.startsWith("sha256:") ? pin.slice("sha256:".length) : pin;
}

function normalizePins(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v === "string" && v.length > 0) out[k] = v;
	}
	return out;
}

export async function agentPinStatus(
	_parent: unknown,
	args: { agentId: string },
	ctx: GraphQLContext,
) {
	const callerTenantId = await resolveCallerTenantId(ctx);
	if (!callerTenantId) {
		throw new GraphQLError("Unauthorized", {
			extensions: { code: "UNAUTHORIZED" },
		});
	}

	const [agent] = await db
		.select({
			id: agents.id,
			slug: agents.slug,
			tenant_id: agents.tenant_id,
			template_id: agents.template_id,
			agent_pinned_versions: agents.agent_pinned_versions,
		})
		.from(agents)
		.where(eq(agents.id, args.agentId));
	if (!agent || agent.tenant_id !== callerTenantId || !agent.slug || !agent.template_id) {
		throw new GraphQLError("Agent not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}

	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, agent.tenant_id));
	const [template] = await db
		.select({ slug: agentTemplates.slug })
		.from(agentTemplates)
		.where(eq(agentTemplates.id, agent.template_id));
	if (!tenant?.slug || !template?.slug) {
		throw new GraphQLError("Tenant or template slug missing", {
			extensions: { code: "INTERNAL_SERVER_ERROR" },
		});
	}

	const pins = normalizePins(agent.agent_pinned_versions);

	const out: Array<{
		filename: string;
		pinnedSha: string | null;
		latestSha: string | null;
		updateAvailable: boolean;
		pinnedContent: string | null;
		latestContent: string | null;
	}> = [];

	for (const filename of PINNED_FILES) {
		const latestContent = await readTemplateBaseWithFallback(
			tenant.slug,
			template.slug,
			filename,
		);
		const latestHex = latestContent === null ? null : computeSha256(latestContent);

		const pinnedPin = pins[filename] ?? null;
		const pinnedHex = extractHex(pinnedPin);

		let pinnedContent: string | null = null;
		if (pinnedHex) {
			// Look up by content-addressable store first (stable).
			pinnedContent = await readVersionStore(
				tenant.slug,
				template.slug,
				filename,
				pinnedHex,
			);
			// Fallback: if the current template/defaults hash matches the
			// pin, use that content. Covers agents whose version store
			// hasn't been populated yet (e.g. transition-period rows).
			if (pinnedContent === null && latestHex === pinnedHex && latestContent !== null) {
				pinnedContent = latestContent;
			}
		}

		out.push({
			filename,
			pinnedSha: pinnedHex ? `sha256:${pinnedHex}` : null,
			latestSha: latestHex ? `sha256:${latestHex}` : null,
			updateAvailable: Boolean(pinnedHex && latestHex && pinnedHex !== latestHex),
			pinnedContent,
			latestContent,
		});
	}

	return out;
}
