import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";
import {
	BedrockClient,
	CreateGuardrailCommand,
	CreateGuardrailVersionCommand,
	UpdateGuardrailCommand,
	DeleteGuardrailCommand,
	type CreateGuardrailCommandInput,
} from "@aws-sdk/client-bedrock";

const { guardrails, guardrailBlocks, agentTemplates } = schema;

const bedrock = new BedrockClient({ region: process.env.AWS_REGION || "us-east-1" });

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

interface FilterStrength {
	inputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
	outputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

interface GuardrailConfig {
	contentFilters?: {
		hate?: FilterStrength;
		insults?: FilterStrength;
		sexual?: FilterStrength;
		violence?: FilterStrength;
		misconduct?: FilterStrength;
	};
	deniedTopics?: Array<{
		name: string;
		definition: string;
		examples?: string[];
	}>;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// GET /api/guardrails
		if (path === "/api/guardrails" && method === "GET") {
			return listGuardrails(tenantId);
		}

		// POST /api/guardrails
		if (path === "/api/guardrails" && method === "POST") {
			return createGuardrail(tenantId, event);
		}

		// GET /api/guardrails/stats
		if (path === "/api/guardrails/stats" && method === "GET") {
			return getStats(tenantId);
		}

		// Routes with guardrail ID
		const idMatch = path.match(/^\/api\/guardrails\/([0-9a-f-]+)$/);
		if (idMatch) {
			const guardrailId = idMatch[1];
			if (method === "GET") return getGuardrail(tenantId, guardrailId);
			if (method === "PUT") return updateGuardrail(tenantId, guardrailId, event);
			if (method === "DELETE") return deleteGuardrail(tenantId, guardrailId);
		}

		// PUT /api/guardrails/:id/default
		const defaultMatch = path.match(/^\/api\/guardrails\/([0-9a-f-]+)\/default$/);
		if (defaultMatch && method === "PUT") {
			return toggleDefault(tenantId, defaultMatch[1], event);
		}

		// GET/PUT /api/guardrails/:id/templates
		const templatesMatch = path.match(/^\/api\/guardrails\/([0-9a-f-]+)\/templates$/);
		if (templatesMatch) {
			if (method === "GET") return listAssignedTemplates(tenantId, templatesMatch[1]);
			if (method === "PUT") return assignTemplates(tenantId, templatesMatch[1], event);
		}

		return error("Route not found", 404);
	} catch (err) {
		console.error("Guardrails handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// GET /api/guardrails
// ---------------------------------------------------------------------------

async function listGuardrails(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(guardrails)
		.where(eq(guardrails.tenant_id, tenantId))
		.orderBy(desc(guardrails.created_at));

	// Count assigned templates per guardrail
	const templateCounts = await db
		.select({
			guardrail_id: agentTemplates.guardrail_id,
			count: count(),
		})
		.from(agentTemplates)
		.where(
			and(
				eq(agentTemplates.tenant_id, tenantId),
				sql`${agentTemplates.guardrail_id} IS NOT NULL`,
			),
		)
		.groupBy(agentTemplates.guardrail_id);

	const countMap = new Map(
		templateCounts.map((r: { guardrail_id: string | null; count: number }) => [r.guardrail_id, Number(r.count)]),
	);

	return json(
		rows.map((row: { id: string; [key: string]: unknown }) => ({
			...row,
			assigned_templates_count: countMap.get(row.id) || 0,
		})),
	);
}

// ---------------------------------------------------------------------------
// GET /api/guardrails/:id
// ---------------------------------------------------------------------------

async function getGuardrail(
	tenantId: string,
	guardrailId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [row] = await db
		.select()
		.from(guardrails)
		.where(and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)));

	if (!row) return notFound("Guardrail not found");

	const assignedTemplates = await db
		.select({ id: agentTemplates.id, name: agentTemplates.name, slug: agentTemplates.slug })
		.from(agentTemplates)
		.where(
			and(eq(agentTemplates.tenant_id, tenantId), eq(agentTemplates.guardrail_id, guardrailId)),
		);

	return json({ ...row, assigned_templates: assignedTemplates });
}

// ---------------------------------------------------------------------------
// POST /api/guardrails
// ---------------------------------------------------------------------------

async function createGuardrail(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { name, description, config } = body as {
		name: string;
		description?: string;
		config: GuardrailConfig;
	};

	if (!name) return error("name is required");

	const bedrockConfig = buildBedrockConfig(name, description, config);

	// Create guardrail in Bedrock
	const createResult = await bedrock.send(
		new CreateGuardrailCommand(bedrockConfig),
	);

	if (!createResult.guardrailId) {
		return error("Failed to create Bedrock guardrail", 500);
	}

	// Create a published version
	const versionResult = await bedrock.send(
		new CreateGuardrailVersionCommand({
			guardrailIdentifier: createResult.guardrailId,
		}),
	);

	const bedrockVersion = versionResult.version || "1";

	// Insert into DB
	const [row] = await db
		.insert(guardrails)
		.values({
			tenant_id: tenantId,
			name,
			description: description || null,
			bedrock_guardrail_id: createResult.guardrailId,
			bedrock_version: bedrockVersion,
			status: "active",
			config: config || {},
		})
		.returning();

	return json(row, 201);
}

// ---------------------------------------------------------------------------
// PUT /api/guardrails/:id
// ---------------------------------------------------------------------------

async function updateGuardrail(
	tenantId: string,
	guardrailId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [existing] = await db
		.select()
		.from(guardrails)
		.where(and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)));

	if (!existing) return notFound("Guardrail not found");

	const body = JSON.parse(event.body || "{}");
	const { name, description, config } = body as {
		name?: string;
		description?: string;
		config?: GuardrailConfig;
	};

	const effectiveName = name || existing.name;
	const effectiveDescription = description ?? (existing.description || undefined);
	const effectiveConfig = config || (existing.config as GuardrailConfig);

	// Update in Bedrock
	if (existing.bedrock_guardrail_id) {
		const bedrockConfig = buildBedrockConfig(
			effectiveName,
			effectiveDescription,
			effectiveConfig,
		);
		await bedrock.send(
			new UpdateGuardrailCommand({
				guardrailIdentifier: existing.bedrock_guardrail_id,
				name: bedrockConfig.name,
				description: bedrockConfig.description,
				blockedInputMessaging: bedrockConfig.blockedInputMessaging,
				blockedOutputsMessaging: bedrockConfig.blockedOutputsMessaging,
				contentPolicyConfig: bedrockConfig.contentPolicyConfig,
				topicPolicyConfig: bedrockConfig.topicPolicyConfig,
			}),
		);

		// Create new version
		const versionResult = await bedrock.send(
			new CreateGuardrailVersionCommand({
				guardrailIdentifier: existing.bedrock_guardrail_id,
			}),
		);

		const [updated] = await db
			.update(guardrails)
			.set({
				name: effectiveName,
				description: effectiveDescription || null,
				config: effectiveConfig,
				bedrock_version: versionResult.version || existing.bedrock_version,
				updated_at: new Date(),
			})
			.where(eq(guardrails.id, guardrailId))
			.returning();

		return json(updated);
	}

	return error("Guardrail has no Bedrock resource", 500);
}

// ---------------------------------------------------------------------------
// DELETE /api/guardrails/:id
// ---------------------------------------------------------------------------

async function deleteGuardrail(
	tenantId: string,
	guardrailId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [existing] = await db
		.select()
		.from(guardrails)
		.where(and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)));

	if (!existing) return notFound("Guardrail not found");

	// Unset templates using this guardrail
	await db
		.update(agentTemplates)
		.set({ guardrail_id: null })
		.where(
			and(eq(agentTemplates.tenant_id, tenantId), eq(agentTemplates.guardrail_id, guardrailId)),
		);

	// Delete in Bedrock
	if (existing.bedrock_guardrail_id) {
		try {
			await bedrock.send(
				new DeleteGuardrailCommand({
					guardrailIdentifier: existing.bedrock_guardrail_id,
				}),
			);
		} catch (err) {
			console.warn("Bedrock guardrail delete failed (may already be deleted):", err);
		}
	}

	// Hard delete from DB
	await db.delete(guardrails).where(eq(guardrails.id, guardrailId));

	return json({ deleted: true });
}

// ---------------------------------------------------------------------------
// PUT /api/guardrails/:id/default
// ---------------------------------------------------------------------------

async function toggleDefault(
	tenantId: string,
	guardrailId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { is_default } = body as { is_default: boolean };

	const [existing] = await db
		.select()
		.from(guardrails)
		.where(and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)));

	if (!existing) return notFound("Guardrail not found");

	if (is_default) {
		// Unset any existing default for this tenant
		await db
			.update(guardrails)
			.set({ is_default: false, updated_at: new Date() })
			.where(
				and(eq(guardrails.tenant_id, tenantId), eq(guardrails.is_default, true)),
			);
	}

	const [updated] = await db
		.update(guardrails)
		.set({ is_default: !!is_default, updated_at: new Date() })
		.where(eq(guardrails.id, guardrailId))
		.returning();

	return json(updated);
}

// ---------------------------------------------------------------------------
// GET /api/guardrails/:id/templates
// ---------------------------------------------------------------------------

async function listAssignedTemplates(
	tenantId: string,
	guardrailId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: agentTemplates.id,
			name: agentTemplates.name,
			slug: agentTemplates.slug,
			model: agentTemplates.model,
		})
		.from(agentTemplates)
		.where(
			and(eq(agentTemplates.tenant_id, tenantId), eq(agentTemplates.guardrail_id, guardrailId)),
		);

	return json(rows);
}

// ---------------------------------------------------------------------------
// PUT /api/guardrails/:id/templates
// ---------------------------------------------------------------------------

async function assignTemplates(
	tenantId: string,
	guardrailId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { template_ids } = body as { template_ids: string[] };

	if (!Array.isArray(template_ids)) return error("template_ids must be an array");

	// Verify guardrail exists
	const [existing] = await db
		.select()
		.from(guardrails)
		.where(and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)));

	if (!existing) return notFound("Guardrail not found");

	// Unset all templates previously assigned to this guardrail
	await db
		.update(agentTemplates)
		.set({ guardrail_id: null })
		.where(
			and(eq(agentTemplates.tenant_id, tenantId), eq(agentTemplates.guardrail_id, guardrailId)),
		);

	// Assign the new set
	if (template_ids.length > 0) {
		for (const templateId of template_ids) {
			await db
				.update(agentTemplates)
				.set({ guardrail_id: guardrailId })
				.where(and(eq(agentTemplates.id, templateId), eq(agentTemplates.tenant_id, tenantId)));
		}
	}

	return json({ assigned: template_ids.length });
}

// ---------------------------------------------------------------------------
// GET /api/guardrails/stats
// ---------------------------------------------------------------------------

async function getStats(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const now = new Date();
	const day1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

	// Guardrail count
	const [guardrailCount] = await db
		.select({ count: count() })
		.from(guardrails)
		.where(eq(guardrails.tenant_id, tenantId));

	// Block counts by period
	const [blocks24h] = await db
		.select({ count: count() })
		.from(guardrailBlocks)
		.where(
			and(
				eq(guardrailBlocks.tenant_id, tenantId),
				gte(guardrailBlocks.created_at, day1),
			),
		);

	const [blocks7d] = await db
		.select({ count: count() })
		.from(guardrailBlocks)
		.where(
			and(
				eq(guardrailBlocks.tenant_id, tenantId),
				gte(guardrailBlocks.created_at, day7),
			),
		);

	const [blocks30d] = await db
		.select({ count: count() })
		.from(guardrailBlocks)
		.where(
			and(
				eq(guardrailBlocks.tenant_id, tenantId),
				gte(guardrailBlocks.created_at, day30),
			),
		);

	// Blocks by type (INPUT/OUTPUT) last 30 days
	const blocksByType = await db
		.select({
			block_type: guardrailBlocks.block_type,
			count: count(),
		})
		.from(guardrailBlocks)
		.where(
			and(
				eq(guardrailBlocks.tenant_id, tenantId),
				gte(guardrailBlocks.created_at, day30),
			),
		)
		.groupBy(guardrailBlocks.block_type);

	// Blocks by action (reason) last 30 days
	const blocksByAction = await db
		.select({
			action: guardrailBlocks.action,
			count: count(),
		})
		.from(guardrailBlocks)
		.where(
			and(
				eq(guardrailBlocks.tenant_id, tenantId),
				gte(guardrailBlocks.created_at, day30),
			),
		)
		.groupBy(guardrailBlocks.action);

	// Recent blocks (last 20)
	const recentBlocks = await db
		.select()
		.from(guardrailBlocks)
		.where(eq(guardrailBlocks.tenant_id, tenantId))
		.orderBy(desc(guardrailBlocks.created_at))
		.limit(20);

	// Templates with guardrails assigned
	const [templatesWithGuardrails] = await db
		.select({ count: count() })
		.from(agentTemplates)
		.where(
			and(
				eq(agentTemplates.tenant_id, tenantId),
				sql`${agentTemplates.guardrail_id} IS NOT NULL`,
			),
		);

	return json({
		guardrails_count: Number(guardrailCount.count),
		templates_with_guardrails: Number(templatesWithGuardrails.count),
		blocks_24h: Number(blocks24h.count),
		blocks_7d: Number(blocks7d.count),
		blocks_30d: Number(blocks30d.count),
		blocks_by_type: blocksByType.map((r: { block_type: string; count: number }) => ({
			type: r.block_type,
			count: Number(r.count),
		})),
		blocks_by_action: blocksByAction.map((r: { action: string; count: number }) => ({
			action: r.action,
			count: Number(r.count),
		})),
		recent_blocks: recentBlocks,
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBedrockConfig(
	name: string,
	description: string | undefined,
	config: GuardrailConfig,
) {
	// Bedrock guardrail names must match [0-9a-zA-Z-_]+
	const bedrockName = name.replace(/[^0-9a-zA-Z_-]/g, "-");
	const params: CreateGuardrailCommandInput = {
		name: bedrockName,
		description: description || `Guardrail: ${name}`,
		blockedInputMessaging:
			"This request was blocked by a content policy.",
		blockedOutputsMessaging:
			"This request was blocked by a content policy.",
	};

	// Content filters
	if (config.contentFilters) {
		const filters: Array<{
			type: "HATE" | "INSULTS" | "SEXUAL" | "VIOLENCE" | "MISCONDUCT";
			inputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
			outputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
		}> = [];
		const filterTypes: Array<[keyof NonNullable<GuardrailConfig["contentFilters"]>, string]> = [
			["hate", "HATE"],
			["insults", "INSULTS"],
			["sexual", "SEXUAL"],
			["violence", "VIOLENCE"],
			["misconduct", "MISCONDUCT"],
		];

		for (const [key, type] of filterTypes) {
			const f = config.contentFilters[key];
			if (f) {
				filters.push({
					type: type as "HATE" | "INSULTS" | "SEXUAL" | "VIOLENCE" | "MISCONDUCT",
					inputStrength: (f.inputStrength || "MEDIUM") as "NONE" | "LOW" | "MEDIUM" | "HIGH",
					outputStrength: (f.outputStrength || "MEDIUM") as "NONE" | "LOW" | "MEDIUM" | "HIGH",
				});
			}
		}

		if (filters.length > 0) {
			params.contentPolicyConfig = { filtersConfig: filters };
		}
	}

	// Topic denial
	if (config.deniedTopics && config.deniedTopics.length > 0) {
		params.topicPolicyConfig = {
			topicsConfig: config.deniedTopics.map((t) => ({
				name: t.name,
				definition: t.definition,
				examples: t.examples || [],
				type: "DENY" as const,
			})),
		};
	}

	return params;
}
