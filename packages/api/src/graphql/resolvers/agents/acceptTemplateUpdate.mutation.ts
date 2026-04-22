/**
 * acceptTemplateUpdate mutation (Unit 9).
 *
 * Advances an agent's pinned hash for a guardrail-class file
 * (GUARDRAILS.md / PLATFORM.md / CAPABILITIES.md) to the current
 * template-base hash, and removes any agent-scoped override of that
 * file. The UI calls this after an operator reviews the diff in the
 * Accept Template Update dialog.
 *
 * Invariants:
 *   - Admin-gated: owner / admin of the agent's tenant.
 *   - Filename must be in PINNED_FILES.
 *   - Idempotent: accepting when already on the latest hash is a no-op.
 *   - Writes the latest content to the content-addressable version store
 *     before bumping the pin, so the composer can always serve the new
 *     hash by lookup.
 *   - Invalidates the composer cache so the next read reflects the
 *     advanced pin.
 *
 * The core pin-advance logic is factored into `applyPinAdvance` so
 * acceptTemplateUpdateBulk can reuse it without re-doing admin checks or
 * re-reading the template content per-agent.
 */

import { GraphQLError } from "graphql";
import {
	DeleteObjectCommand,
	NoSuchKey,
	S3Client,
} from "@aws-sdk/client-s3";
import type { GraphQLContext } from "../../context.js";
import {
	agents,
	agentTemplates,
	agentToCamel,
	db,
	eq,
	tenants,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";
import {
	computeSha256,
	persistTemplateVersion,
	readTemplateBaseWithFallback,
} from "../../../lib/pinned-versions.js";
import { invalidateComposerCache } from "../../../lib/workspace-overlay.js";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

function agentOverrideKey(
	tenantSlug: string,
	agentSlug: string,
	path: string,
): string {
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${path}`;
}

export function isPinnedFile(path: string): boolean {
	return (PINNED_FILES as readonly string[]).includes(path);
}

export function normalizePins(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v === "string" && v.length > 0) out[k] = v;
	}
	return out;
}

export interface PinAdvanceInput {
	agentId: string;
	agentSlug: string;
	tenantId: string;
	tenantSlug: string;
	templateSlug: string;
	filename: string;
	currentPins: Record<string, string>;
	latestContent: string;
	latestHex: string;
}

/**
 * Apply the pin advance to a single agent. Pure of auth / GraphQL — the
 * caller has already done admin gating and input validation. Returns the
 * updated row (or null if the agent disappeared mid-flight).
 */
export async function applyPinAdvance(
	input: PinAdvanceInput,
): Promise<typeof agents.$inferSelect | null> {
	const latestPin = `sha256:${input.latestHex}`;

	// Always make sure the latest content exists in the version store.
	// Idempotent, so cheap on re-runs.
	await persistTemplateVersion(
		input.tenantSlug,
		input.templateSlug,
		input.filename,
		input.latestHex,
		input.latestContent,
	);

	// No-op if already on latest.
	if (input.currentPins[input.filename] === latestPin) {
		const [row] = await db
			.select()
			.from(agents)
			.where(eq(agents.id, input.agentId));
		return row ?? null;
	}

	const updatedPins = { ...input.currentPins, [input.filename]: latestPin };
	const [updated] = await db
		.update(agents)
		.set({
			agent_pinned_versions: updatedPins,
			updated_at: new Date(),
		})
		.where(eq(agents.id, input.agentId))
		.returning();
	if (!updated) return null;

	const bkt = bucket();
	if (bkt) {
		try {
			await s3.send(
				new DeleteObjectCommand({
					Bucket: bkt,
					Key: agentOverrideKey(
						input.tenantSlug,
						input.agentSlug,
						input.filename,
					),
				}),
			);
		} catch (err) {
			const name = (err as { name?: string } | null)?.name;
			if (!(err instanceof NoSuchKey) && name !== "NoSuchKey") {
				throw err;
			}
		}
	}

	invalidateComposerCache({ tenantId: input.tenantId, agentId: input.agentId });
	return updated;
}

export async function acceptTemplateUpdate(
	_parent: unknown,
	args: { agentId: string; filename: string },
	ctx: GraphQLContext,
) {
	const { agentId, filename } = args;
	if (!isPinnedFile(filename)) {
		throw new GraphQLError(
			`acceptTemplateUpdate: '${filename}' is not a pinned-class file`,
			{ extensions: { code: "BAD_USER_INPUT" } },
		);
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
		.where(eq(agents.id, agentId));
	if (!agent || !agent.slug || !agent.template_id) {
		throw new GraphQLError("Agent not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}

	await requireTenantAdmin(ctx, agent.tenant_id);

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

	const latestContent = await readTemplateBaseWithFallback(
		tenant.slug,
		template.slug,
		filename,
	);
	if (latestContent === null) {
		throw new GraphQLError(
			`No template-base content for ${filename} — cannot advance pin`,
			{ extensions: { code: "NOT_FOUND" } },
		);
	}
	const latestHex = computeSha256(latestContent);

	const row = await applyPinAdvance({
		agentId: agent.id,
		agentSlug: agent.slug,
		tenantId: agent.tenant_id,
		tenantSlug: tenant.slug,
		templateSlug: template.slug,
		filename,
		currentPins: normalizePins(agent.agent_pinned_versions),
		latestContent,
		latestHex,
	});
	if (!row) {
		throw new GraphQLError("Failed to advance pin", {
			extensions: { code: "INTERNAL_SERVER_ERROR" },
		});
	}
	return agentToCamel(row);
}
