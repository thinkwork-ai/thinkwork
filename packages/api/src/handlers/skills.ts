import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	SecretsManagerClient,
	CreateSecretCommand,
	UpdateSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agentSkills, skillCatalog, tenantSkills, tenantMcpServers, agentMcpServers, agentTemplateMcpServers } from "@thinkwork/database-pg/schema";
import { parse as parseYaml } from "yaml";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

const s3 = new S3Client({});
const sm = new SecretsManagerClient({});
const db = getDb();
const BUCKET = process.env.WORKSPACE_BUCKET!;
const CATALOG_PREFIX = "skills/catalog";
const STAGE = process.env.STAGE || "dev";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
	// Accept Bearer token (admin UI), x-api-key (mobile app), or AppSync API key
	const token = extractBearerToken(event) || event.headers["x-api-key"] || "";
	const apiSecret = process.env.API_AUTH_SECRET || "";
	const appsyncKey = process.env.APPSYNC_API_KEY || process.env.GRAPHQL_API_KEY || "";
	const isAuthed = (apiSecret && token === apiSecret) || (appsyncKey && token === appsyncKey);
	if (!token || !isAuthed) return unauthorized();

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// --- Catalog routes ---

		// GET /api/skills/catalog
		if (path === "/api/skills/catalog" && method === "GET") {
			return getCatalogIndex();
		}

		// GET /api/skills/catalog/:slug/files (list) or /api/skills/catalog/:slug/files/* (get)
		const catalogFilesMatch = path.match(
			/^\/api\/skills\/catalog\/([^/]+)\/files(?:\/(.+))?$/,
		);
		if (catalogFilesMatch && method === "GET") {
			const [, slug, filePath] = catalogFilesMatch;
			if (filePath) return getCatalogFile(slug, filePath);
			return listCatalogFiles(slug);
		}

		// GET /api/skills/catalog/:slug
		const catalogSlugMatch = path.match(/^\/api\/skills\/catalog\/([^/]+)$/);
		if (catalogSlugMatch && method === "GET") {
			return getCatalogSkill(catalogSlugMatch[1]);
		}

		// --- Tenant routes ---

		const tenantSlug = event.headers["x-tenant-slug"];

		// GET /api/skills/tenant
		if (path === "/api/skills/tenant" && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return getTenantSkills(tenantSlug);
		}

		// POST /api/skills/tenant/create — create a new custom skill from template
		if (path === "/api/skills/tenant/create" && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return createTenantSkill(tenantSlug, event);
		}

		// POST /api/skills/tenant/:slug/install
		const installMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/install$/,
		);
		if (installMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return installSkill(tenantSlug, installMatch[1]);
		}

		// POST /api/skills/tenant/:slug/upload — upload skill zip
		const uploadMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upload$/,
		);
		if (uploadMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return getUploadUrl(tenantSlug, uploadMatch[1]);
		}

		// GET /api/skills/tenant/:slug/files — list files in tenant skill
		const tenantFileListMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/files$/,
		);
		if (tenantFileListMatch && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return listTenantSkillFiles(tenantSlug, tenantFileListMatch[1]);
		}

		// GET/PUT/POST/DELETE /api/skills/tenant/:slug/files/*
		const tenantFilesMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/files\/(.+)$/,
		);
		if (tenantFilesMatch) {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const [, slug, filePath] = tenantFilesMatch;
			if (method === "GET") return getTenantFile(tenantSlug, slug, filePath);
			if (method === "PUT") return saveTenantFile(tenantSlug, slug, filePath, event);
			if (method === "POST") return createTenantFile(tenantSlug, slug, filePath, event);
			if (method === "DELETE") return deleteTenantFile(tenantSlug, slug, filePath);
			return error("Method not allowed", 405);
		}

		// GET /api/skills/tenant/:slug/upgradeable
		const upgradeableMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upgradeable$/,
		);
		if (upgradeableMatch && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return checkUpgradeable(tenantSlug, upgradeableMatch[1]);
		}

		// POST /api/skills/tenant/:slug/upgrade
		const upgradeMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upgrade$/,
		);
		if (upgradeMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const force = event.queryStringParameters?.force === "true";
			return upgradeSkill(tenantSlug, upgradeMatch[1], force);
		}

		// DELETE /api/skills/tenant/:slug
		const tenantDeleteMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)$/,
		);
		if (tenantDeleteMatch && method === "DELETE") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const forceDelete = event.queryStringParameters?.force === "true";
			return uninstallSkill(tenantSlug, tenantDeleteMatch[1], forceDelete);
		}

		// POST /api/skills/agent/:agentSlug/install/:skillSlug
		const agentInstallMatch = path.match(
			/^\/api\/skills\/agent\/([^/]+)\/install\/([^/]+)$/,
		);
		if (agentInstallMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return installSkillToAgent(tenantSlug, agentInstallMatch[1], agentInstallMatch[2]);
		}

		// POST /api/skills/agent/:agentId/:skillId/credentials
		const credMatch = path.match(
			/^\/api\/skills\/agent\/([^/]+)\/([^/]+)\/credentials$/,
		);
		if (credMatch && method === "POST") {
			return saveSkillCredentials(credMatch[1], credMatch[2], event);
		}

		// --- MCP Server routes (tenant-level registry) ---

		// GET /api/skills/mcp-servers — list tenant's MCP servers
		if (path === "/api/skills/mcp-servers" && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpListTenantServers(tenantSlug);
		}

		// POST /api/skills/mcp-servers — register MCP server
		if (path === "/api/skills/mcp-servers" && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpRegisterServer(tenantSlug, event);
		}

		// PUT /api/skills/mcp-servers/:id — update MCP server
		const mcpUpdateMatch = path.match(/^\/api\/skills\/mcp-servers\/([^/]+)$/);
		if (mcpUpdateMatch && method === "PUT") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpUpdateServer(tenantSlug, mcpUpdateMatch[1], event);
		}

		// DELETE /api/skills/mcp-servers/:id — remove MCP server
		if (mcpUpdateMatch && method === "DELETE") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpDeleteServer(tenantSlug, mcpUpdateMatch[1]);
		}

		// POST /api/skills/mcp-servers/:id/test — test connection + cache tools
		const mcpTestMatch = path.match(/^\/api\/skills\/mcp-servers\/([^/]+)\/test$/);
		if (mcpTestMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpTestConnection(tenantSlug, mcpTestMatch[1]);
		}

		// --- MCP Server routes (agent-level assignment) ---

		// GET /api/skills/agents/:agentId/mcp-servers — list agent's assigned MCP servers
		const agentMcpListMatch = path.match(/^\/api\/skills\/agents\/([^/]+)\/mcp-servers$/);
		if (agentMcpListMatch && method === "GET") {
			return mcpListAgentServers(agentMcpListMatch[1]);
		}

		// POST /api/skills/agents/:agentId/mcp-servers — assign MCP server to agent
		if (agentMcpListMatch && method === "POST") {
			return mcpAssignToAgent(agentMcpListMatch[1], event);
		}

		// DELETE /api/skills/agents/:agentId/mcp-servers/:mcpServerId — unassign
		const agentMcpDeleteMatch = path.match(/^\/api\/skills\/agents\/([^/]+)\/mcp-servers\/([^/]+)$/);
		if (agentMcpDeleteMatch && method === "DELETE") {
			return mcpUnassignFromAgent(agentMcpDeleteMatch[1], agentMcpDeleteMatch[2]);
		}

		// GET /api/skills/oauth-providers — list configured OAuth providers (for admin dropdown)
		if (path === "/api/skills/oauth-providers" && method === "GET") {
			return mcpListOAuthProviders();
		}

		// GET /api/skills/templates/:templateId/mcp-servers — list template's MCP servers
		const templateMcpMatch = path.match(/^\/api\/skills\/templates\/([^/]+)\/mcp-servers$/);
		if (templateMcpMatch && method === "GET") {
			return mcpGetTemplateMcpServers(templateMcpMatch[1]);
		}

		// POST /api/skills/templates/:templateId/mcp-servers — assign MCP server to template
		if (templateMcpMatch && method === "POST") {
			return mcpAssignToTemplate(templateMcpMatch[1], event);
		}

		// DELETE /api/skills/templates/:templateId/mcp-servers/:mcpServerId — unassign
		const templateMcpDeleteMatch = path.match(/^\/api\/skills\/templates\/([^/]+)\/mcp-servers\/([^/]+)$/);
		if (templateMcpDeleteMatch && method === "DELETE") {
			return mcpUnassignFromTemplate(templateMcpDeleteMatch[1], templateMcpDeleteMatch[2]);
		}

		// GET /api/skills/user-mcp-servers — list MCP servers for the current user (for mobile app)
		if (path === "/api/skills/user-mcp-servers" && method === "GET") {
			const tenantId = event.headers["x-tenant-id"];
			const userId = event.headers["x-principal-id"];
			if (!tenantId || !userId) return error("x-tenant-id and x-principal-id headers required", 400);
			return mcpListUserServers(tenantId, userId);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Skills handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Catalog routes
// ---------------------------------------------------------------------------

async function getCatalogIndex(): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db.select().from(skillCatalog).execute();
	return json(
		rows.map((r) => ({
			slug: r.slug,
			name: r.display_name,
			description: r.description,
			category: r.category,
			version: r.version,
			author: r.author,
			icon: r.icon,
			tags: r.tags || [],
			source: r.source,
			is_default: r.is_default,
			execution: r.execution,
			requires_env: r.requires_env || [],
			oauth_provider: r.oauth_provider,
			oauth_scopes: r.oauth_scopes || [],
			mcp_server: r.mcp_server,
			mcp_tools: r.mcp_tools || [],
			dependencies: r.dependencies || [],
			triggers: r.triggers || [],
		})),
	);
}

async function getCatalogSkill(
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${slug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found");
	const parsed = parseYaml(yamlText) as Record<string, unknown>;
	// Normalize display_name → name for API consumers
	if (parsed.display_name && !parsed.name) {
		parsed.name = parsed.display_name;
	}
	return json(parsed);
}

async function listCatalogFiles(
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const prefix = `${CATALOG_PREFIX}/${slug}/`;
	const files = await listS3Keys(prefix);
	// Return paths relative to skill root
	return json(files.map((f) => f.slice(prefix.length)));
}

async function getCatalogFile(
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const content = await getS3Text(`${CATALOG_PREFIX}/${slug}/${filePath}`);
	if (content === null) return notFound("File not found");
	return json({ path: filePath, content });
}

// ---------------------------------------------------------------------------
// Tenant routes
// ---------------------------------------------------------------------------

function tenantSkillsPrefix(tenantSlug: string) {
	return `tenants/${tenantSlug}/skills`;
}

async function getTenantSkills(
	tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Auto-provision built-in skills (PRD-31)
	await ensureBuiltinSkills(tenantId);

	// Read from DB
	const rows = await db
		.select({
			skill_id: tenantSkills.skill_id,
			source: tenantSkills.source,
			version: tenantSkills.version,
			catalog_version: tenantSkills.catalog_version,
			enabled: tenantSkills.enabled,
			installed_at: tenantSkills.installed_at,
			// Join with catalog for metadata
			name: skillCatalog.display_name,
			description: skillCatalog.description,
			category: skillCatalog.category,
			icon: skillCatalog.icon,
			execution: skillCatalog.execution,
			is_default: skillCatalog.is_default,
			oauth_provider: skillCatalog.oauth_provider,
			mcp_server: skillCatalog.mcp_server,
			triggers: skillCatalog.triggers,
		})
		.from(tenantSkills)
		.leftJoin(skillCatalog, eq(tenantSkills.skill_id, skillCatalog.slug))
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.enabled, true),
			),
		)
		.execute();

	return json(
		rows.map((r) => ({
			slug: r.skill_id,
			name: r.name || r.skill_id,
			description: r.description,
			category: r.category,
			version: r.version,
			icon: r.icon,
			source: r.source,
			execution: r.execution,
			is_default: r.is_default,
			catalogVersion: r.catalog_version,
			oauthProvider: r.oauth_provider,
			mcpServer: r.mcp_server,
			triggers: r.triggers || [],
			installedAt: r.installed_at?.toISOString(),
		})),
	);
}

async function installSkill(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Verify skill exists in catalog
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${slug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found in catalog");

	// List all catalog files for this skill
	const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
	const files = await listS3Keys(catalogPrefix);

	// Copy each file to tenant prefix (editable copy)
	const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${tenantPrefix}${relativePath}`,
			}),
		);
	}

	// Get catalog version for tracking
	const [catalogEntry] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	const catalogVersion = catalogEntry?.version;

	const meta = parseYaml(yamlText);

	// Upsert into tenant_skills DB (PRD-31)
	await db
		.insert(tenantSkills)
		.values({
			tenant_id: tenantId,
			skill_id: slug,
			source: "catalog",
			version: meta.version || "1.0.0",
			catalog_version: catalogVersion || meta.version || "1.0.0",
			enabled: true,
			updated_at: new Date(),
		})
		.onConflictDoUpdate({
			target: [tenantSkills.tenant_id, tenantSkills.skill_id],
			set: {
				source: "catalog",
				version: meta.version || "1.0.0",
				catalog_version: catalogVersion || meta.version || "1.0.0",
				enabled: true,
				updated_at: new Date(),
			},
		});

	// Also update S3 installed.json (backward compat during migration)
	const installedRaw = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
	);
	const installed: Array<Record<string, unknown>> = installedRaw
		? JSON.parse(installedRaw)
		: [];
	const filtered = installed.filter((s) => s.slug !== slug);
	filtered.push({
		slug: meta.slug,
		name: meta.name,
		description: meta.description,
		category: meta.category,
		version: meta.version,
		icon: meta.icon,
		installedAt: new Date().toISOString(),
	});
	await putS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
		JSON.stringify(filtered, null, 2),
	);

	// --- Dependency resolution ---
	const [catalogEntry2] = await db
		.select({ dependencies: skillCatalog.dependencies })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);

	const deps = catalogEntry2?.dependencies || [];
	const dependenciesInstalled: string[] = [];

	if (deps.length > 0) {
		const installing = new Set<string>([slug]);
		await resolveDependencies(tenantId, tenantSlug, deps, installing, dependenciesInstalled);
	}

	return json({ success: true, slug, dependenciesInstalled });
}

/** Recursively install missing dependencies with cycle detection */
async function resolveDependencies(
	tenantId: string,
	tenantSlug: string,
	deps: string[],
	installing: Set<string>,
	installed: string[],
): Promise<void> {
	for (const depSlug of deps) {
		if (installing.has(depSlug)) {
			throw new Error(`Circular dependency detected: ${depSlug}`);
		}
		installing.add(depSlug);

		// Check if already installed and enabled
		const [existing] = await db
			.select({ enabled: tenantSkills.enabled })
			.from(tenantSkills)
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.skill_id, depSlug),
					eq(tenantSkills.enabled, true),
				),
			)
			.limit(1);

		if (!existing) {
			// Auto-install the dependency
			const depYaml = await getS3Text(`${CATALOG_PREFIX}/${depSlug}/skill.yaml`);
			if (!depYaml) continue; // skip if not in catalog

			const depCatalogPrefix = `${CATALOG_PREFIX}/${depSlug}/`;
			const depFiles = await listS3Keys(depCatalogPrefix);
			const depTenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${depSlug}/`;

			for (const key of depFiles) {
				const relativePath = key.slice(depCatalogPrefix.length);
				await s3.send(
					new CopyObjectCommand({
						Bucket: BUCKET,
						CopySource: `${BUCKET}/${key}`,
						Key: `${depTenantPrefix}${relativePath}`,
					}),
				);
			}

			const depMeta = parseYaml(depYaml);
			const [depCatalogEntry] = await db
				.select({ version: skillCatalog.version })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, depSlug))
				.limit(1);

			await db
				.insert(tenantSkills)
				.values({
					tenant_id: tenantId,
					skill_id: depSlug,
					source: "catalog",
					version: depMeta.version || "1.0.0",
					catalog_version: depCatalogEntry?.version || depMeta.version || "1.0.0",
					enabled: true,
					updated_at: new Date(),
				})
				.onConflictDoUpdate({
					target: [tenantSkills.tenant_id, tenantSkills.skill_id],
					set: {
						source: "catalog",
						version: depMeta.version || "1.0.0",
						catalog_version: depCatalogEntry?.version || depMeta.version || "1.0.0",
						enabled: true,
						updated_at: new Date(),
					},
				});

			installed.push(depSlug);

			// Recursively resolve transitive dependencies
			const [depCatalog] = await db
				.select({ dependencies: skillCatalog.dependencies })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, depSlug))
				.limit(1);
			const transitiveDeps = depCatalog?.dependencies || [];
			if (transitiveDeps.length > 0) {
				await resolveDependencies(tenantId, tenantSlug, transitiveDeps, installing, installed);
			}
		}
	}
}

async function getTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const content = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`,
	);
	if (content === null) return notFound("File not found");
	return json({ path: filePath, content });
}

async function saveTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (typeof body.content !== "string")
		return error("content (string) is required");

	await putS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`,
		body.content,
	);
	return json({ success: true, path: filePath });
}

// ---------------------------------------------------------------------------
// PRD-31 Phase 3: Tenant-uploadable custom skills
// ---------------------------------------------------------------------------

const SKILL_YAML_TEMPLATE = `slug: {{slug}}
display_name: {{name}}
description: {{description}}
category: custom
version: "1.0.0"
author: tenant
icon: zap
tags: []
execution: context
triggers: []
`;

const SKILL_MD_TEMPLATE = `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

## Overview

Describe what this skill does and when to use it.

## Instructions

Add your skill instructions here. Keep this file under 200 lines.
Move detailed reference material to the references/ folder.
`;

async function createTenantSkill(
	tenantSlug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");
	const { name, slug: rawSlug, description } = body;
	if (!name) return error("name is required", 400);

	// Generate slug from name if not provided
	const slug = rawSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
	if (!slug) return error("Could not generate slug from name", 400);

	// Check for collision with catalog skills
	const [existing] = await db
		.select({ slug: skillCatalog.slug })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	if (existing) return error(`Slug '${slug}' conflicts with a catalog skill`, 409);

	// Check for collision with tenant skills
	const [existingTenant] = await db
		.select({ skill_id: tenantSkills.skill_id })
		.from(tenantSkills)
		.where(and(eq(tenantSkills.tenant_id, tenantId), eq(tenantSkills.skill_id, slug)))
		.limit(1);
	if (existingTenant) return error(`Skill '${slug}' already exists for this tenant`, 409);

	const desc = description || `Custom skill: ${name}`;
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}`;

	// Create skill.yaml from template
	const yamlContent = SKILL_YAML_TEMPLATE
		.replace(/\{\{slug\}\}/g, slug)
		.replace(/\{\{name\}\}/g, name)
		.replace(/\{\{description\}\}/g, desc);
	await putS3Text(`${prefix}/skill.yaml`, yamlContent);

	// Create SKILL.md from template
	const mdContent = SKILL_MD_TEMPLATE
		.replace(/\{\{slug\}\}/g, slug)
		.replace(/\{\{name\}\}/g, name)
		.replace(/\{\{description\}\}/g, desc);
	await putS3Text(`${prefix}/SKILL.md`, mdContent);

	// Insert into tenant_skills
	await db.insert(tenantSkills).values({
		tenant_id: tenantId,
		skill_id: slug,
		source: "tenant",
		version: "1.0.0",
		enabled: true,
	}).onConflictDoNothing();

	return json({ success: true, slug, files: ["skill.yaml", "SKILL.md"] });
}

async function getUploadUrl(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Generate a presigned URL for the tenant to upload a skill zip
	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/_upload.zip`;
	const command = new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		ContentType: "application/zip",
	});
	const url = await getSignedUrl(s3, command, { expiresIn: 300 });
	return json({ uploadUrl: url, key });
}

async function listTenantSkillFiles(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const files = await listS3Keys(prefix);
	// Return paths relative to skill root, filter out upload artifacts
	return json(
		files
			.map((f) => f.slice(prefix.length))
			.filter((f) => !f.startsWith("_upload") && f.length > 0),
	);
}

async function createTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const content = typeof body.content === "string" ? body.content : "";

	// Validate: Python scripts only
	if (filePath.startsWith("scripts/") && !filePath.endsWith(".py")) {
		return error("Only Python (.py) scripts are allowed", 400);
	}

	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`;

	// Check if file already exists
	const existing = await getS3Text(key);
	if (existing !== null) {
		return error(`File '${filePath}' already exists. Use PUT to update.`, 409);
	}

	await putS3Text(key, content);
	return json({ success: true, path: filePath, created: true });
}

async function deleteTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Don't allow deleting skill.yaml — it's required
	if (filePath === "skill.yaml") {
		return error("Cannot delete skill.yaml — it is required", 400);
	}

	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`;
	await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
	return json({ success: true, path: filePath, deleted: true });
}

async function uninstallSkill(
	tenantSlug: string,
	slug: string,
	force = false,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);

	// Check for dependents before uninstalling
	if (tenantId && !force) {
		// Get all installed tenant skills
		const installedRows = await db
			.select({ skill_id: tenantSkills.skill_id })
			.from(tenantSkills)
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.enabled, true),
				),
			);

		// For each installed skill, check if it depends on the skill being uninstalled
		const dependents: string[] = [];
		for (const row of installedRows) {
			if (row.skill_id === slug) continue;
			const [catalogRow] = await db
				.select({ dependencies: skillCatalog.dependencies })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, row.skill_id))
				.limit(1);
			const deps = catalogRow?.dependencies || [];
			if (deps.includes(slug)) {
				dependents.push(row.skill_id);
			}
		}

		if (dependents.length > 0) {
			return json({ hasDependents: true, dependents }, 409);
		}
	}

	// Soft-disable in DB (PRD-31)
	if (tenantId) {
		await db
			.update(tenantSkills)
			.set({ enabled: false, updated_at: new Date() })
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.skill_id, slug),
				),
			);
	}

	// Delete all files under tenant skill prefix
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const keys = await listS3Keys(prefix);
	for (const key of keys) {
		await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
	}

	// Update installed.json (backward compat)
	const installedRaw = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
	);
	if (installedRaw) {
		const installed: Array<Record<string, unknown>> = JSON.parse(installedRaw);
		const filtered = installed.filter((s) => s.slug !== slug);
		await putS3Text(
			`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
			JSON.stringify(filtered, null, 2),
		);
	}

	return json({ success: true, slug });
}

// ---------------------------------------------------------------------------
// Agent-level skill install
// ---------------------------------------------------------------------------

async function installSkillToAgent(
	tenantSlug: string,
	agentSlug: string,
	skillSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Verify skill exists in catalog
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${skillSlug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found in catalog");

	// List all catalog files for this skill
	const catalogPrefix = `${CATALOG_PREFIX}/${skillSlug}/`;
	const files = await listS3Keys(catalogPrefix);

	// Copy each file to agent-level prefix
	const agentPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/skills/${skillSlug}/`;
	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${agentPrefix}${relativePath}`,
			}),
		);
	}

	return json({ success: true, slug: skillSlug });
}

// ---------------------------------------------------------------------------
// Agent skill credentials
// ---------------------------------------------------------------------------

async function saveSkillCredentials(
	agentId: string,
	skillId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const env = body.env;
	if (!env || typeof env !== "object" || Object.keys(env).length === 0) {
		return error("env object with at least one key is required", 400);
	}

	const secretName = `thinkwork/${STAGE}/agent-skills/${agentId}/${skillId}`;
	const secretValue = JSON.stringify({ type: "skillEnv", env });

	let secretArn: string;
	try {
		// Try to update existing secret first
		const res = await sm.send(
			new UpdateSecretCommand({
				SecretId: secretName,
				SecretString: secretValue,
			}),
		);
		secretArn = res.ARN!;
	} catch (err: any) {
		if (err instanceof ResourceNotFoundException) {
			// Create new secret
			const res = await sm.send(
				new CreateSecretCommand({
					Name: secretName,
					SecretString: secretValue,
				}),
			);
			secretArn = res.ARN!;
		} else {
			throw err;
		}
	}

	// Update agent_skills.config with secretRef
	const [existing] = await db
		.select({ id: agentSkills.id, config: agentSkills.config })
		.from(agentSkills)
		.where(
			and(
				eq(agentSkills.agent_id, agentId),
				eq(agentSkills.skill_id, skillId),
			),
		);

	if (!existing) {
		return error("Skill not attached to this agent", 404);
	}

	const currentConfig = (existing.config as Record<string, unknown>) || {};
	await db
		.update(agentSkills)
		.set({ config: { ...currentConfig, secretRef: secretArn } })
		.where(eq(agentSkills.id, existing.id));

	return json({ ok: true, secretRef: secretArn });
}

// ---------------------------------------------------------------------------
// MCP Server — Tenant Registry (uses tenant_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListTenantServers(
	tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const rows = await db
		.select()
		.from(tenantMcpServers)
		.where(eq(tenantMcpServers.tenant_id, tenantId));

	return json({
		servers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			slug: r.slug,
			url: r.url,
			transport: r.transport,
			authType: r.auth_type,
			oauthProvider: r.oauth_provider,
			tools: r.tools,
			enabled: r.enabled,
			createdAt: r.created_at,
		})),
	});
}

async function mcpRegisterServer(
	tenantSlug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");
	const { name, url, transport, authType, apiKey, oauthProvider } = body;

	if (!name || !url) return error("name and url are required", 400);

	const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		return error("name must be lowercase alphanumeric with hyphens", 400);
	}

	// Store API key in Secrets Manager if provided
	let authConfig: Record<string, unknown> | null = null;
	if (authType === "tenant_api_key" && apiKey) {
		const secretName = `thinkwork/${STAGE}/mcp/${tenantId}/${slug}`;
		const secretValue = JSON.stringify({ type: "mcpApiKey", token: apiKey });
		try {
			await sm.send(new UpdateSecretCommand({ SecretId: secretName, SecretString: secretValue }));
		} catch (err: any) {
			if (err instanceof ResourceNotFoundException) {
				await sm.send(new CreateSecretCommand({ Name: secretName, SecretString: secretValue }));
			} else {
				throw err;
			}
		}
		authConfig = { secretRef: secretName, token: apiKey };
	}

	// Check for existing
	const [existing] = await db
		.select({ id: tenantMcpServers.id })
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.tenant_id, tenantId), eq(tenantMcpServers.slug, slug)));

	if (existing) {
		await db
			.update(tenantMcpServers)
			.set({
				name,
				url,
				transport: transport || "streamable-http",
				auth_type: authType || "none",
				auth_config: authConfig,
				oauth_provider: oauthProvider || null,
				updated_at: new Date(),
			})
			.where(eq(tenantMcpServers.id, existing.id));
		return json({ id: existing.id, slug, updated: true });
	}

	const [inserted] = await db
		.insert(tenantMcpServers)
		.values({
			tenant_id: tenantId,
			name,
			slug,
			url,
			transport: transport || "streamable-http",
			auth_type: authType || "none",
			auth_config: authConfig,
			oauth_provider: oauthProvider || null,
		})
		.returning({ id: tenantMcpServers.id });

	return json({ id: inserted.id, slug, created: true });
}

async function mcpUpdateServer(
	tenantSlug: string,
	serverId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (body.name !== undefined) updates.name = body.name;
	if (body.url !== undefined) updates.url = body.url;
	if (body.transport !== undefined) updates.transport = body.transport;
	if (body.enabled !== undefined) updates.enabled = body.enabled;

	const result = await db
		.update(tenantMcpServers)
		.set(updates)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)))
		.returning({ id: tenantMcpServers.id });

	if (result.length === 0) return notFound("MCP server not found");
	return json({ ok: true, id: serverId });
}

async function mcpDeleteServer(
	tenantSlug: string,
	serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Delete agent assignments first (cascade)
	await db
		.delete(agentMcpServers)
		.where(eq(agentMcpServers.mcp_server_id, serverId));

	const deleted = await db
		.delete(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)))
		.returning({ id: tenantMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server not found");
	return json({ ok: true, deleted: serverId });
}

async function mcpTestConnection(
	tenantSlug: string,
	serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const [row] = await db
		.select()
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)));

	if (!row) return notFound("MCP server not found");

	// Build auth headers
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (row.auth_type === "tenant_api_key") {
		const authCfg = (row.auth_config as Record<string, unknown>) || {};
		const token = authCfg.token as string;
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}

	try {
		const response = await fetch(row.url, {
			method: "POST",
			headers,
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return json({ ok: false, error: `MCP server returned ${response.status}` }, 502);
		}

		const result = await response.json() as {
			result?: { tools?: Array<{ name: string; description?: string }> };
			error?: unknown;
		};
		if (result.error) {
			return json({ ok: false, error: result.error }, 502);
		}

		const tools = (result.result?.tools || []).map((t) => ({
			name: t.name,
			description: t.description,
		}));

		// Cache discovered tools in DB
		await db
			.update(tenantMcpServers)
			.set({ tools, updated_at: new Date() })
			.where(eq(tenantMcpServers.id, serverId));

		return json({ ok: true, tools });
	} catch (err: any) {
		return json({ ok: false, error: err.message || "Connection failed" }, 502);
	}
}

// ---------------------------------------------------------------------------
// MCP Server — Agent Assignment (uses agent_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListAgentServers(
	agentId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: agentMcpServers.id,
			mcp_server_id: agentMcpServers.mcp_server_id,
			enabled: agentMcpServers.enabled,
			config: agentMcpServers.config,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			transport: tenantMcpServers.transport,
			auth_type: tenantMcpServers.auth_type,
			oauth_provider: tenantMcpServers.oauth_provider,
			tools: tenantMcpServers.tools,
			server_enabled: tenantMcpServers.enabled,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(eq(agentMcpServers.agent_id, agentId));

	return json({
		servers: rows.map((r) => ({
			id: r.id,
			mcpServerId: r.mcp_server_id,
			name: r.name,
			slug: r.slug,
			url: r.url,
			transport: r.transport,
			authType: r.auth_type,
			oauthProvider: r.oauth_provider,
			tools: r.tools,
			enabled: r.enabled && r.server_enabled,
			config: r.config,
		})),
	});
}

async function mcpAssignToAgent(
	agentId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { mcpServerId, config } = body;

	if (!mcpServerId) return error("mcpServerId is required", 400);

	// Resolve agent's tenant_id
	const { agents } = await import("@thinkwork/database-pg/schema");
	const [agentRow] = await db
		.select({ tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agentRow) return error("Agent not found", 404);

	// Verify MCP server belongs to same tenant
	const [server] = await db
		.select({ id: tenantMcpServers.id })
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, mcpServerId), eq(tenantMcpServers.tenant_id, agentRow.tenant_id)));
	if (!server) return error("MCP server not found in this tenant", 404);

	// Upsert
	const [existing] = await db
		.select({ id: agentMcpServers.id })
		.from(agentMcpServers)
		.where(and(eq(agentMcpServers.agent_id, agentId), eq(agentMcpServers.mcp_server_id, mcpServerId)));

	if (existing) {
		await db
			.update(agentMcpServers)
			.set({ enabled: true, config: config || null, updated_at: new Date() })
			.where(eq(agentMcpServers.id, existing.id));
		return json({ id: existing.id, updated: true });
	}

	const [inserted] = await db
		.insert(agentMcpServers)
		.values({
			agent_id: agentId,
			tenant_id: agentRow.tenant_id,
			mcp_server_id: mcpServerId,
			config: config || null,
		})
		.returning({ id: agentMcpServers.id });

	return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromAgent(
	agentId: string,
	mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const deleted = await db
		.delete(agentMcpServers)
		.where(and(eq(agentMcpServers.agent_id, agentId), eq(agentMcpServers.mcp_server_id, mcpServerId)))
		.returning({ id: agentMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server assignment not found");
	return json({ ok: true });
}

// ---------------------------------------------------------------------------
// MCP Server — OAuth Providers + User View
// ---------------------------------------------------------------------------

async function mcpGetTemplateMcpServers(
	templateId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: agentTemplateMcpServers.id,
			mcp_server_id: agentTemplateMcpServers.mcp_server_id,
			enabled: agentTemplateMcpServers.enabled,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			auth_type: tenantMcpServers.auth_type,
		})
		.from(agentTemplateMcpServers)
		.innerJoin(tenantMcpServers, eq(agentTemplateMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(eq(agentTemplateMcpServers.template_id, templateId));

	return json({
		mcpServers: rows.map((r) => ({
			mcp_server_id: r.mcp_server_id,
			enabled: r.enabled,
			name: r.name,
			slug: r.slug,
			url: r.url,
			authType: r.auth_type,
		})),
	});
}

async function mcpAssignToTemplate(
	templateId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { mcpServerId } = body;
	if (!mcpServerId) return error("mcpServerId is required", 400);

	// Resolve tenant_id from template
	const { agentTemplates } = await import("@thinkwork/database-pg/schema");
	const [template] = await db
		.select({ tenant_id: agentTemplates.tenant_id })
		.from(agentTemplates)
		.where(eq(agentTemplates.id, templateId));
	if (!template) return error("Template not found", 404);

	// Upsert
	const [existing] = await db
		.select({ id: agentTemplateMcpServers.id })
		.from(agentTemplateMcpServers)
		.where(and(eq(agentTemplateMcpServers.template_id, templateId), eq(agentTemplateMcpServers.mcp_server_id, mcpServerId)));

	if (existing) {
		await db
			.update(agentTemplateMcpServers)
			.set({ enabled: true, updated_at: new Date() })
			.where(eq(agentTemplateMcpServers.id, existing.id));
		return json({ id: existing.id, updated: true });
	}

	const [inserted] = await db
		.insert(agentTemplateMcpServers)
		.values({
			template_id: templateId,
			tenant_id: template.tenant_id!,
			mcp_server_id: mcpServerId,
		})
		.returning({ id: agentTemplateMcpServers.id });

	return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromTemplate(
	templateId: string,
	mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const deleted = await db
		.delete(agentTemplateMcpServers)
		.where(and(eq(agentTemplateMcpServers.template_id, templateId), eq(agentTemplateMcpServers.mcp_server_id, mcpServerId)))
		.returning({ id: agentTemplateMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server not assigned to template");
	return json({ ok: true });
}

async function mcpListOAuthProviders(): Promise<APIGatewayProxyStructuredResultV2> {
	const { connectProviders } = await import("@thinkwork/database-pg/schema");
	const rows = await db
		.select({
			id: connectProviders.id,
			name: connectProviders.name,
			display_name: connectProviders.display_name,
			provider_type: connectProviders.provider_type,
			is_available: connectProviders.is_available,
		})
		.from(connectProviders)
		.where(eq(connectProviders.is_available, true));

	return json({
		providers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			displayName: r.display_name,
			providerType: r.provider_type,
		})),
	});
}

async function mcpListUserServers(
	tenantId: string,
	userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const { agents, userMcpTokens } = await import("@thinkwork/database-pg/schema");

	// Find all agents paired with this user
	const userAgents = await db
		.select({ id: agents.id, name: agents.name })
		.from(agents)
		.where(and(eq(agents.tenant_id, tenantId), eq(agents.human_pair_id, userId)));

	if (userAgents.length === 0) {
		return json({ servers: [] });
	}

	const agentIds = userAgents.map((a) => a.id);

	// Get all MCP servers assigned to these agents
	const rows = await db
		.select({
			assignment_id: agentMcpServers.id,
			agent_id: agentMcpServers.agent_id,
			mcp_server_id: agentMcpServers.mcp_server_id,
			enabled: agentMcpServers.enabled,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			auth_type: tenantMcpServers.auth_type,
			tools: tenantMcpServers.tools,
			server_enabled: tenantMcpServers.enabled,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(inArray(agentMcpServers.agent_id, agentIds));

	// For OAuth servers, check if user has an active token in user_mcp_tokens
	const oauthServerIds = rows.filter((r) => r.auth_type === "oauth" || r.auth_type === "per_user_oauth").map((r) => r.mcp_server_id);

	const userTokens = oauthServerIds.length > 0
		? await db
			.select({
				mcp_server_id: userMcpTokens.mcp_server_id,
				status: userMcpTokens.status,
			})
			.from(userMcpTokens)
			.where(and(
				eq(userMcpTokens.user_id, userId),
				eq(userMcpTokens.tenant_id, tenantId),
			))
		: [];

	const tokenByServer = new Map(userTokens.map((t) => [t.mcp_server_id, t]));

	// Deduplicate MCP servers (same server may be assigned to multiple agents)
	const seen = new Set<string>();
	const servers = rows
		.filter((r) => {
			if (seen.has(r.mcp_server_id)) return false;
			seen.add(r.mcp_server_id);
			return true;
		})
		.map((r) => {
			let authStatus: "active" | "not_connected" | "expired" = "active";
			if (r.auth_type === "oauth" || r.auth_type === "per_user_oauth") {
				const tok = tokenByServer.get(r.mcp_server_id);
				if (!tok) authStatus = "not_connected";
				else if (tok.status !== "active") authStatus = "expired";
			}
			const agentName = userAgents.find((a) => a.id === r.agent_id)?.name;
			return {
				id: r.mcp_server_id,
				name: r.name,
				slug: r.slug,
				url: r.url,
				authType: r.auth_type,
				tools: r.tools,
				enabled: r.enabled && r.server_enabled,
				authStatus,
				agentName,
			};
		});

	return json({ servers });
}

// ---------------------------------------------------------------------------
// PRD-31: DB helpers
// ---------------------------------------------------------------------------

/** Resolve tenant slug to tenant UUID */
async function resolveTenantId(tenantSlug: string): Promise<string | null> {
	const { tenants } = await import("@thinkwork/database-pg/schema");
	const [row] = await db
		.select({ id: tenants.id })
		.from(tenants)
		.where(eq(tenants.slug, tenantSlug))
		.limit(1);
	return row?.id ?? null;
}

/** Ensure all is_default skills are provisioned for this tenant */
async function ensureBuiltinSkills(tenantId: string): Promise<void> {
	const defaults = await db
		.select({ slug: skillCatalog.slug, version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.is_default, true));

	if (defaults.length === 0) return;

	// Check which are already installed
	const existing = await db
		.select({ skill_id: tenantSkills.skill_id })
		.from(tenantSkills)
		.where(eq(tenantSkills.tenant_id, tenantId));

	const existingSet = new Set(existing.map((r) => r.skill_id));

	for (const skill of defaults) {
		if (existingSet.has(skill.slug)) continue;
		await db.insert(tenantSkills).values({
			tenant_id: tenantId,
			skill_id: skill.slug,
			source: "builtin",
			version: skill.version,
			catalog_version: skill.version,
			enabled: true,
		}).onConflictDoNothing();
	}
}

/** Check if a skill has a newer version in the catalog */
async function checkUpgradeable(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const [installed] = await db
		.select({ catalog_version: tenantSkills.catalog_version })
		.from(tenantSkills)
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		)
		.limit(1);

	if (!installed) return notFound("Skill not installed");

	const [catalog] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);

	if (!catalog) return notFound("Skill not in catalog");

	return json({
		upgradeable: installed.catalog_version !== catalog.version,
		currentVersion: installed.catalog_version,
		latestVersion: catalog.version,
	});
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------

async function upgradeSkill(
	tenantSlug: string,
	slug: string,
	force: boolean,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Look up latest catalog version
	const [catalog] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	if (!catalog) return notFound("Skill not in catalog");

	// Look up tenant's installed version
	const [installed] = await db
		.select({
			catalog_version: tenantSkills.catalog_version,
			version: tenantSkills.version,
		})
		.from(tenantSkills)
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		)
		.limit(1);
	if (!installed) return notFound("Skill not installed");

	const currentVersion = installed.catalog_version || installed.version;
	const latestVersion = catalog.version;

	// Check for customizations unless force
	if (!force) {
		const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
		const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;

		const catalogKeys = await listS3Keys(catalogPrefix);
		const tenantKeys = await listS3Keys(tenantPrefix);

		const catalogRelative = new Set(catalogKeys.map((k) => k.slice(catalogPrefix.length)));
		const tenantRelative = tenantKeys.map((k) => k.slice(tenantPrefix.length));

		// Files that exist in tenant but not in catalog = customizations
		const customizedFiles = tenantRelative.filter(
			(f) => !f.startsWith("_upload") && !catalogRelative.has(f),
		);

		if (customizedFiles.length > 0) {
			return json({
				upgradeable: true,
				hasCustomizations: true,
				currentVersion,
				latestVersion,
				customizedFiles,
			});
		}
	}

	// Perform upgrade: re-copy catalog files to tenant prefix
	const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
	const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const files = await listS3Keys(catalogPrefix);

	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${tenantPrefix}${relativePath}`,
			}),
		);
	}

	// Update DB versions
	await db
		.update(tenantSkills)
		.set({
			catalog_version: latestVersion,
			version: latestVersion,
			updated_at: new Date(),
		})
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		);

	return json({
		upgraded: true,
		previousVersion: currentVersion,
		newVersion: latestVersion,
	});
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

async function getS3Text(key: string): Promise<string | null> {
	try {
		const res = await s3.send(
			new GetObjectCommand({ Bucket: BUCKET, Key: key }),
		);
		return (await res.Body?.transformToString("utf-8")) ?? null;
	} catch (err: any) {
		if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
			return null;
		}
		throw err;
	}
}

async function putS3Text(key: string, content: string): Promise<void> {
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			Body: content,
			ContentType: key.endsWith(".json") ? "application/json" : "text/plain",
		}),
	);
}

async function listS3Keys(prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const res = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of res.Contents ?? []) {
			if (obj.Key) keys.push(obj.Key);
		}
		continuationToken = res.NextContinuationToken;
	} while (continuationToken);

	return keys;
}
