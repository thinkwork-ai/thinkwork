/**
 * Workspace files Lambda — composer-backed, Cognito-authenticated.
 *
 * Route: POST /api/workspaces/files (via the /api/workspaces/{proxy+} API
 * Gateway route). Replaces the previous `API_AUTH_SECRET`-bearer handler;
 * the bearer path is gone — every caller sends a Cognito ID token.
 *
 * Request shape (Unit 5):
 *   { action: "get" | "list" | "put" | "delete" | "regenerate-map" | "update-identity-field",
 *     agentId?: string, templateId?: string, defaults?: true,
 *     path?: string, content?: string, acceptTemplateUpdate?: boolean }
 *
 *   Exactly one of agentId / templateId / defaults:true identifies the
 *   target surface. Tenant identity is derived from the caller's JWT via
 *   `resolveCallerFromAuth` — the handler NEVER trusts a tenantSlug body
 *   field. Requests that still include one are rejected (400) so buggy
 *   clients surface loud instead of drifting silently across tenants.
 *
 * Responses:
 *   get  → { ok: true, content, source, sha256 }
 *   list → { ok: true, files: Array<{ path, source, sha256, overridden }> }
 *   put  → { ok: true }
 *   delete → { ok: true }
 *   regenerate-map → { ok: true }
 *   errors → { ok: false, error }
 *
 * Auth model:
 *   - Cognito JWT required. Unauthenticated → 401.
 *   - Caller's tenant is resolved via resolveCallerFromAuth. Missing → 401.
 *   - agentId / templateId are validated against the caller's tenant.
 *     Mismatch → 404 (no "this exists in another tenant" leakage).
 *   - Put on a pinned file via agentId without `acceptTemplateUpdate: true`
 *     returns 403. The acceptTemplateUpdate GraphQL mutation (Unit 9) is
 *     the intended path; the flag here keeps the door open for admin-UI
 *     diff-preview flows that write a new override after accepting.
 */

import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { authenticate, type AuthResult } from "./src/lib/cognito-auth.js";
import { resolveCallerFromAuth } from "./src/graphql/resolvers/core/resolve-auth-user.js";
import {
	composeFile,
	composeList,
	invalidateComposerCache,
	type ComposeContext,
	type ComposeResult,
} from "./src/lib/workspace-overlay.js";
import { classifyFile, PINNED_FILES } from "@thinkwork/workspace-defaults";
import { regenerateManifest } from "./src/lib/workspace-manifest.js";
import { deriveAgentSkills } from "./src/lib/derive-agent-skills.js";
import {
	agents,
	agentTemplates,
	and,
	db,
	eq,
	tenantMembers,
	tenants,
} from "./src/graphql/utils.js";

// ---------------------------------------------------------------------------
// API Gateway shims
// ---------------------------------------------------------------------------

interface APIGatewayProxyEvent {
	headers?: Record<string, string | undefined>;
	body?: string | null;
	requestContext?: { http?: { method?: string } };
}

interface APIGatewayProxyResult {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

// CORS headers mirror packages/api/src/lib/response.ts so the admin SPA
// (localhost:5175 in dev, the static-site bucket in prod) and the mobile
// app can hit this endpoint from the browser / WebView. The API Gateway
// has tenant-scoped cors_configuration too, but HTTP API proxy
// integrations forward OPTIONS to the Lambda — so we must respond 2xx
// ourselves or the browser preflight fails.
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, x-api-key, x-tenant-id, x-principal-id",
	"Access-Control-Max-Age": "3600",
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
	return {
		statusCode,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		body: JSON.stringify(body),
	};
}

function corsPreflight(): APIGatewayProxyResult {
	return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

// ---------------------------------------------------------------------------
// Key builders (must match workspace-overlay.ts / workspace-copy.ts)
// ---------------------------------------------------------------------------

function agentKey(tenantSlug: string, agentSlug: string, path: string): string {
	const clean = path.replace(/^\/+/, "");
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${clean}`;
}

function agentPrefix(tenantSlug: string, agentSlug: string): string {
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

function templateKey(tenantSlug: string, templateSlug: string, path: string): string {
	const clean = path.replace(/^\/+/, "");
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${clean}`;
}

function templatePrefix(tenantSlug: string, templateSlug: string): string {
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

function defaultsKey(tenantSlug: string, path: string): string {
	const clean = path.replace(/^\/+/, "");
	return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${clean}`;
}

function defaultsPrefix(tenantSlug: string): string {
	return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

interface AgentTarget {
	kind: "agent";
	tenantSlug: string;
	agentSlug: string;
	agentId: string;
	prefix: string;
	key: (path: string) => string;
}

interface TemplateTarget {
	kind: "template";
	tenantSlug: string;
	templateSlug: string;
	prefix: string;
	key: (path: string) => string;
}

interface DefaultsTarget {
	kind: "defaults";
	tenantSlug: string;
	prefix: string;
	key: (path: string) => string;
}

type Target = AgentTarget | TemplateTarget | DefaultsTarget;

async function resolveAgentTarget(
	tenantId: string,
	agentId: string,
): Promise<AgentTarget | null> {
	const [agent] = await db
		.select({
			id: agents.id,
			slug: agents.slug,
			tenant_id: agents.tenant_id,
		})
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== tenantId || !agent.slug) return null;

	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, agent.tenant_id));
	if (!tenant?.slug) return null;

	const slug = agent.slug;
	const tSlug = tenant.slug;
	return {
		kind: "agent",
		tenantSlug: tSlug,
		agentSlug: slug,
		agentId: agent.id,
		prefix: agentPrefix(tSlug, slug),
		key: (path) => agentKey(tSlug, slug, path),
	};
}

async function resolveTemplateTarget(
	tenantId: string,
	templateId: string,
): Promise<TemplateTarget | null> {
	const [template] = await db
		.select({
			id: agentTemplates.id,
			slug: agentTemplates.slug,
			tenant_id: agentTemplates.tenant_id,
		})
		.from(agentTemplates)
		.where(eq(agentTemplates.id, templateId));
	if (!template || template.tenant_id !== tenantId || !template.slug) return null;

	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, tenantId));
	if (!tenant?.slug) return null;

	const tSlug = tenant.slug;
	const tmplSlug = template.slug;
	return {
		kind: "template",
		tenantSlug: tSlug,
		templateSlug: tmplSlug,
		prefix: templatePrefix(tSlug, tmplSlug),
		key: (path) => templateKey(tSlug, tmplSlug, path),
	};
}

async function resolveDefaultsTarget(tenantId: string): Promise<DefaultsTarget | null> {
	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, tenantId));
	if (!tenant?.slug) return null;
	const tSlug = tenant.slug;
	return {
		kind: "defaults",
		tenantSlug: tSlug,
		prefix: defaultsPrefix(tSlug),
		key: (path) => defaultsKey(tSlug, path),
	};
}

// ---------------------------------------------------------------------------
// Authz — REST analogue of requireTenantAdmin (mirrors plugin-upload.ts)
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = new Set([
	"put",
	"delete",
	"regenerate-map",
	"update-identity-field",
]);

async function callerIsTenantAdmin(
	tenantId: string,
	principalId: string | null,
): Promise<boolean> {
	if (!principalId) return false;
	const rows = await db
		.select({ role: tenantMembers.role })
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_id, principalId),
			),
		)
		.limit(1);
	const role = rows[0]?.role;
	return role === "owner" || role === "admin";
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

interface HandlerDeps {
	auth: AuthResult;
	tenantId: string;
	target: Target;
}

async function handleGet(
	deps: HandlerDeps,
	path: string,
): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;
	if (target.kind === "agent") {
		const ctx: ComposeContext = { tenantId };
		try {
			const result = await composeFile(ctx, target.agentId, path);
			return json(200, {
				ok: true,
				content: result.content,
				source: result.source,
				sha256: result.sha256,
			});
		} catch (err) {
			if ((err as { code?: string } | null)?.code === "FILE_NOT_FOUND") {
				return json(200, { ok: true, content: null, source: "defaults", sha256: "" });
			}
			throw err;
		}
	}

	try {
		const resp = await s3.send(
			new GetObjectCommand({ Bucket: bucket(), Key: target.key(path) }),
		);
		const content = (await resp.Body?.transformToString("utf-8")) ?? "";
		return json(200, {
			ok: true,
			content,
			source: target.kind === "template" ? "template" : "defaults",
			sha256: "",
		});
	} catch (err) {
		if (isNoSuchKey(err)) {
			return json(200, {
				ok: true,
				content: null,
				source: target.kind === "template" ? "template" : "defaults",
				sha256: "",
			});
		}
		throw err;
	}
}

async function handleList(
	deps: HandlerDeps,
	includeContent: boolean,
): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;
	if (target.kind === "agent") {
		const ctx: ComposeContext = { tenantId };
		// Strands container cold-start (Unit 7) sends includeContent=true
		// and writes each file.content to /tmp/workspace. If we dropped the
		// flag, the container would receive metadata-only entries and
		// silently write nothing — the agent boots with no workspace on
		// disk.
		const files = (await composeList(ctx, target.agentId, {
			includeContent,
		})) as ComposeResult[];
		return json(200, {
			ok: true,
			files: files.map((f) => ({
				path: f.path,
				source: f.source,
				sha256: f.sha256,
				overridden:
					f.source === "agent-override" || f.source === "agent-override-pinned",
				...(includeContent ? { content: f.content } : {}),
			})),
		});
	}

	const paths = await listPrefix(target.prefix);
	return json(200, {
		ok: true,
		files: paths.map((p) => ({
			path: p,
			source: target.kind === "template" ? "template" : "defaults",
			sha256: "",
			overridden: false,
		})),
	});
}

function isAgentsMdPath(path: string): boolean {
	return path === "AGENTS.md" || path.endsWith("/AGENTS.md");
}

async function handlePut(
	deps: HandlerDeps,
	path: string,
	content: string,
	acceptTemplateUpdate: boolean,
): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;

	if (target.kind === "agent") {
		// Guardrail-class files require accept-update flag. Unit 9 will wire
		// this up through a GraphQL mutation that bumps the pinned hash
		// atomically; the flag here keeps the door open for admin-UI
		// diff-preview flows that write an override after the operator
		// accepts.
		if (classifyFile(path) === "pinned" && !acceptTemplateUpdate) {
			return json(403, {
				ok: false,
				error: `Cannot write pinned file ${path} without acceptTemplateUpdate. Use the acceptTemplateUpdate mutation (Unit 9) or pass acceptTemplateUpdate: true if you have already reviewed the diff.`,
			});
		}

		await s3.send(
			new PutObjectCommand({
				Bucket: bucket(),
				Key: target.key(path),
				Body: content,
				ContentType: "text/plain; charset=utf-8",
			}),
		);
		await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
		invalidateComposerCache({ tenantId, agentId: target.agentId });

		// U11: AGENTS.md is the canonical authoring surface for routing
		// and skills. After a successful put we re-derive the agent_skills
		// table from the composed tree. The S3 put has already landed by
		// this point — if derive fails we return 500 so the caller knows
		// the DB is stale; the next AGENTS.md save retries the derive.
		if (isAgentsMdPath(path)) {
			try {
				const result = await deriveAgentSkills(
					{ tenantId },
					target.agentId,
				);
				const summary =
					`agent=${target.agentId} agents_md_paths=${result.agentsMdPathsScanned.length} ` +
					`changed=${result.changed} added=${result.addedSlugs.join(",") || "-"} ` +
					`removed=${result.removedSlugs.join(",") || "-"}`;
				console.log(`[derive-agent-skills] ${summary}`);
				if (result.warnings.length > 0) {
					return json(200, {
						ok: true,
						deriveWarnings: result.warnings,
					});
				}
				return json(200, { ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[derive-agent-skills] failed: ${message}`);
				return json(500, {
					ok: false,
					error:
						"AGENTS.md persisted but agent_skills derive failed: " +
						message,
				});
			}
		}

		return json(200, { ok: true });
	}

	// Template / defaults: tenant already validated at target resolution.
	// Invalidate every agent in the tenant — the base layer moved.
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: target.key(path),
			Body: content,
			ContentType: "text/plain; charset=utf-8",
		}),
	);
	invalidateComposerCache({ tenantId, templateScope: true });
	return json(200, { ok: true });
}

async function handleDelete(
	deps: HandlerDeps,
	path: string,
): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;
	await s3.send(
		new DeleteObjectCommand({ Bucket: bucket(), Key: target.key(path) }),
	);
	if (target.kind === "agent") {
		await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
		invalidateComposerCache({ tenantId, agentId: target.agentId });
	} else {
		invalidateComposerCache({ tenantId, templateScope: true });
	}
	return json(200, { ok: true });
}

// Line-surgery anchors for IDENTITY.md personality fields. Only these 4
// lines are editable via `update-identity-field`; the Name line is
// reserved for `update_agent_name` (which goes through the updateAgent
// mutation + writeIdentityMdForAgent). Never exposing Name here is a
// narrow-scope guarantee — the tool's Literal type is backed by this
// server-side whitelist.
const IDENTITY_FIELD_ANCHORS: Record<
	"creature" | "vibe" | "emoji" | "avatar",
	RegExp
> = {
	creature: /^- \*\*Creature:\*\*.*$/m,
	vibe: /^- \*\*Vibe:\*\*.*$/m,
	emoji: /^- \*\*Emoji:\*\*.*$/m,
	avatar: /^- \*\*Avatar:\*\*.*$/m,
};

function identityFieldLabel(
	field: keyof typeof IDENTITY_FIELD_ANCHORS,
): string {
	return field.charAt(0).toUpperCase() + field.slice(1);
}

async function handleUpdateIdentityField(
	deps: HandlerDeps,
	field: string,
	value: string,
): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;
	if (target.kind !== "agent") {
		return json(400, {
			ok: false,
			error: "update-identity-field requires agentId",
		});
	}
	// Service-auth (apikey) callers must present x-agent-id matching the
	// target agent. Mirrors the updateAgent mutation's authz guard —
	// without this, any apikey holder in the tenant can edit another
	// agent's IDENTITY.md personality fields.
	if (deps.auth.authType === "apikey") {
		if (!deps.auth.agentId || deps.auth.agentId !== target.agentId) {
			return json(403, {
				ok: false,
				error: "Service-auth callers must present x-agent-id matching the target agent",
			});
		}
	}
	if (!Object.prototype.hasOwnProperty.call(IDENTITY_FIELD_ANCHORS, field)) {
		return json(400, {
			ok: false,
			error: `Unknown identity field '${field}'. Allowed: creature, vibe, emoji, avatar.`,
		});
	}
	if (typeof value !== "string") {
		return json(400, { ok: false, error: "value must be a string" });
	}
	// Defensive sanitization — mirror writeIdentityMdForAgent's name-line
	// treatment. Newlines collapsed to spaces so a value can't inject
	// extra markdown bullets; the regex replacer function form prevents
	// `$&`, `$'`, `` $` ``, `$1` from expanding as backreferences.
	// Includes U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR — these
	// are treated as line breaks by some Markdown renderers and can
	// otherwise inject a forged bullet past the \r\n guard.
	const safeValue = value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
	const typedField = field as keyof typeof IDENTITY_FIELD_ANCHORS;
	const anchor = IDENTITY_FIELD_ANCHORS[typedField];
	const label = identityFieldLabel(typedField);

	const identityKey = target.key("IDENTITY.md");
	let existing: string | null = null;
	try {
		const resp = await s3.send(
			new GetObjectCommand({ Bucket: bucket(), Key: identityKey }),
		);
		existing = (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		const name = (err as { name?: string } | null)?.name;
		const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
			?.$metadata?.httpStatusCode;
		const isNotFound =
			err instanceof NoSuchKey ||
			name === "NoSuchKey" ||
			name === "NotFound" ||
			status === 404;
		if (!isNotFound) throw err;
	}

	if (!existing || !anchor.test(existing)) {
		return json(422, {
			ok: false,
			error: `IDENTITY.md is missing the ${label} line anchor; have your human rerun the template migration.`,
		});
	}

	const rendered = existing.replace(
		anchor,
		() => `- **${label}:** ${safeValue}`,
	);

	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: identityKey,
			Body: rendered,
			ContentType: "text/plain; charset=utf-8",
		}),
	);
	invalidateComposerCache({ tenantId, agentId: target.agentId });
	return json(200, { ok: true });
}

async function handleRegenerateMap(deps: HandlerDeps): Promise<APIGatewayProxyResult> {
	const { target } = deps;
	if (target.kind !== "agent") {
		return json(400, { ok: false, error: "regenerate-map requires agentId" });
	}
	const { regenerateWorkspaceMap } = await import(
		"./src/lib/workspace-map-generator.js"
	);
	await regenerateWorkspaceMap(target.agentId);
	return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Handler entry point
// ---------------------------------------------------------------------------

interface RequestBody {
	action?: string;
	agentId?: string;
	templateId?: string;
	defaults?: boolean;
	path?: string;
	content?: string;
	acceptTemplateUpdate?: boolean;
	/**
	 * Unit 7 (Strands container cold-start) needs composed content inline
	 * with the list to avoid N round-trips. The composer returns it when
	 * this flag is true.
	 */
	includeContent?: boolean;
	/** For `update-identity-field`: creature | vibe | emoji | avatar. */
	field?: string;
	/** For `update-identity-field`: the new line content. */
	value?: string;
	// Legacy shape — rejected loudly so buggy clients surface.
	tenantSlug?: string;
	instanceId?: string;
}

export async function handler(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
	// Short-circuit CORS preflight BEFORE auth. The API Gateway forwards
	// OPTIONS to the Lambda on proxy integrations, so we have to answer
	// with a 2xx + CORS headers ourselves or browser preflight fails.
	const method = event.requestContext?.http?.method;
	if (method === "OPTIONS") {
		return corsPreflight();
	}

	if (!bucket()) {
		return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
	}

	const headers = normalizeHeaders(event.headers);
	const auth = await authenticate(headers);
	if (!auth) {
		return json(401, { ok: false, error: "Unauthorized" });
	}

	let body: RequestBody;
	try {
		body = event.body ? (JSON.parse(event.body) as RequestBody) : {};
	} catch {
		return json(400, { ok: false, error: "Invalid JSON body" });
	}

	if (body.tenantSlug !== undefined || body.instanceId !== undefined) {
		return json(400, {
			ok: false,
			error:
				"tenantSlug / instanceId are no longer accepted — send agentId, templateId, or defaults: true. Tenant is derived from the caller's token.",
		});
	}

	const { userId, tenantId } = await resolveCallerFromAuth(auth);
	if (!tenantId) {
		return json(401, { ok: false, error: "Could not resolve caller tenant" });
	}

	const action = body.action;
	if (!action) {
		return json(400, { ok: false, error: "action is required" });
	}

	const targetCount =
		(body.agentId ? 1 : 0) + (body.templateId ? 1 : 0) + (body.defaults ? 1 : 0);
	if (targetCount !== 1) {
		return json(400, {
			ok: false,
			error: "Exactly one of agentId, templateId, defaults is required",
		});
	}

	let target: Target | null = null;
	if (body.agentId) {
		target = await resolveAgentTarget(tenantId, body.agentId);
	} else if (body.templateId) {
		target = await resolveTemplateTarget(tenantId, body.templateId);
	} else if (body.defaults) {
		target = await resolveDefaultsTarget(tenantId);
	}
	if (!target) {
		// 404 rather than 403 so the response doesn't leak whether a row
		// exists in another tenant.
		return json(404, { ok: false, error: "Target not found in your tenant" });
	}

	// Write actions require admin/owner role (U31). Reads stay open to any
	// tenant member. The apikey path bypasses the role check — it's the
	// platform-credential trust boundary used by the Strands container and
	// CI/ops bootstrap; per-tenant role doesn't apply.
	//
	// Use the resolved users.id, NOT auth.principalId. tenantMembers.principal_id
	// holds users.id, and Google-federated users have users.id ≠ Cognito sub.
	if (WRITE_ACTIONS.has(action) && auth.authType !== "apikey") {
		const isAdmin = await callerIsTenantAdmin(tenantId, userId);
		if (!isAdmin) {
			return json(403, {
				ok: false,
				error: "Caller is not a tenant admin or owner",
			});
		}
	}

	const deps: HandlerDeps = { auth, tenantId, target };

	try {
		switch (action) {
			case "get": {
				if (!body.path)
					return json(400, { ok: false, error: "path is required for get" });
				return await handleGet(deps, body.path);
			}
			case "list":
				return await handleList(deps, body.includeContent === true);
			case "put": {
				if (!body.path || body.content === undefined) {
					return json(400, {
						ok: false,
						error: "path and content are required for put",
					});
				}
				return await handlePut(
					deps,
					body.path,
					body.content,
					body.acceptTemplateUpdate === true,
				);
			}
			case "delete": {
				if (!body.path)
					return json(400, { ok: false, error: "path is required for delete" });
				return await handleDelete(deps, body.path);
			}
			case "regenerate-map":
				return await handleRegenerateMap(deps);
			case "update-identity-field": {
				if (!body.field || body.value === undefined) {
					return json(400, {
						ok: false,
						error: "field and value are required for update-identity-field",
					});
				}
				return await handleUpdateIdentityField(
					deps,
					String(body.field),
					String(body.value),
				);
			}
			default:
				return json(400, { ok: false, error: `Unknown action: ${action}` });
		}
	} catch (err) {
		return json(500, {
			ok: false,
			error: `Workspace operation failed: ${errorMessage(err)}`,
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeaders(
	raw: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
	if (!raw) return {};
	const out: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(raw)) {
		out[key.toLowerCase()] = value;
		out[key] = value;
	}
	return out;
}

function isNoSuchKey(err: unknown): boolean {
	if (err instanceof NoSuchKey) return true;
	const name = (err as { name?: string } | null)?.name;
	return name === "NoSuchKey";
}

async function listPrefix(prefix: string): Promise<string[]> {
	const paths: string[] = [];
	let continuationToken: string | undefined;
	do {
		const resp = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket(),
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of resp.Contents ?? []) {
			if (!obj.Key) continue;
			const rel = obj.Key.slice(prefix.length);
			if (!rel) continue;
			if (rel === "manifest.json") continue;
			if (rel === "_defaults_version") continue;
			paths.push(rel);
		}
		continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
	} while (continuationToken);
	return paths;
}

function errorMessage(err: unknown): string {
	if (!err || typeof err !== "object") return "unknown error";
	const name = (err as { name?: string }).name || "Error";
	const message = (err as { message?: string }).message || "";
	return message ? `${name}: ${message}` : name;
}

// PINNED_FILES is re-exported for callers/tests that want to assert on
// the guardrail-class set without pulling in workspace-defaults directly.
export { PINNED_FILES };
