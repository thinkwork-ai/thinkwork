/**
 * Workspace files Lambda — composer-backed, Cognito-authenticated.
 *
 * Route: POST /api/workspaces/files (via the /api/workspaces/{proxy+} API
 * Gateway route). Replaces the previous `API_AUTH_SECRET`-bearer handler;
 * the bearer path is gone — every caller sends a Cognito ID token.
 *
 * Request shape (Unit 5):
 *   { action: "get" | "list" | "put" | "delete" | "regenerate-map",
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
import { agents, agentTemplates, db, eq, tenants } from "./src/graphql/utils.js";

// ---------------------------------------------------------------------------
// API Gateway shims
// ---------------------------------------------------------------------------

interface APIGatewayProxyEvent {
	headers?: Record<string, string | undefined>;
	body?: string | null;
}

interface APIGatewayProxyResult {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
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

async function handleList(deps: HandlerDeps): Promise<APIGatewayProxyResult> {
	const { target, tenantId } = deps;
	if (target.kind === "agent") {
		const ctx: ComposeContext = { tenantId };
		const files = (await composeList(ctx, target.agentId)) as ComposeResult[];
		return json(200, {
			ok: true,
			files: files.map((f) => ({
				path: f.path,
				source: f.source,
				sha256: f.sha256,
				overridden:
					f.source === "agent-override" || f.source === "agent-override-pinned",
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
	// Legacy shape — rejected loudly so buggy clients surface.
	tenantSlug?: string;
	instanceId?: string;
}

export async function handler(
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
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

	const { tenantId } = await resolveCallerFromAuth(auth);
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

	const deps: HandlerDeps = { auth, tenantId, target };

	try {
		switch (action) {
			case "get": {
				if (!body.path)
					return json(400, { ok: false, error: "path is required for get" });
				return await handleGet(deps, body.path);
			}
			case "list":
				return await handleList(deps);
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
