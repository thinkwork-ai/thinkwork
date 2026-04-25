/**
 * Unit 5: /api/workspaces/files handler tests.
 *
 * Exercises the security posture (401 unauth, 400 legacy body shape,
 * 404 cross-tenant target, 403 pinned write without accept flag) and the
 * happy-path wiring to the composer + direct-S3 paths.
 *
 * Test strategy:
 *   - Mock Cognito via `authenticate` (from src/lib/cognito-auth.js).
 *   - Mock DB via the same `vi.hoisted` queue pattern workspace-overlay
 *     tests use.
 *   - Mock S3 via aws-sdk-client-mock (so both the handler's S3Client and
 *     the composer's S3Client go through the same mock transport).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

// ─── Hoisted DB mock ─────────────────────────────────────────────────────────

const { dbQueue, pushDbRows, resetDbQueue } = vi.hoisted(() => {
	const queue: unknown[][] = [];
	return {
		dbQueue: queue,
		pushDbRows: (rows: unknown[]) => queue.push(rows),
		resetDbQueue: () => {
			queue.length = 0;
		},
	};
});

vi.mock("../graphql/utils.js", () => {
	const tableCol = (label: string) => ({ __col: label });
	const chain = () => ({
		from: vi.fn().mockImplementation(() => ({
			where: vi.fn().mockImplementation(() => {
				const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
				fn.then = (
					onFulfilled: (v: unknown) => unknown,
					onRejected: (e: unknown) => unknown,
				) => Promise.resolve(dbQueue.shift() ?? []).then(onFulfilled, onRejected);
				fn.limit = vi.fn().mockImplementation(() =>
					Promise.resolve(dbQueue.shift() ?? []),
				);
				return fn;
			}),
		})),
	});
	return {
		db: { select: vi.fn().mockImplementation(() => chain()) },
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		and: (...args: unknown[]) => ({ __and: args }),
		sql: (strings: unknown, ...args: unknown[]) => ({ __sql: [strings, args] }),
		agents: {
			id: tableCol("agents.id"),
			slug: tableCol("agents.slug"),
			name: tableCol("agents.name"),
			tenant_id: tableCol("agents.tenant_id"),
			template_id: tableCol("agents.template_id"),
			human_pair_id: tableCol("agents.human_pair_id"),
			agent_pinned_versions: tableCol("agents.agent_pinned_versions"),
		},
		agentTemplates: {
			id: tableCol("agent_templates.id"),
			slug: tableCol("agent_templates.slug"),
			tenant_id: tableCol("agent_templates.tenant_id"),
		},
		tenants: {
			id: tableCol("tenants.id"),
			slug: tableCol("tenants.slug"),
			name: tableCol("tenants.name"),
		},
		users: {
			id: tableCol("users.id"),
			email: tableCol("users.email"),
			name: tableCol("users.name"),
			tenant_id: tableCol("users.tenant_id"),
		},
		userProfiles: {
			user_id: tableCol("user_profiles.user_id"),
			title: tableCol("user_profiles.title"),
			timezone: tableCol("user_profiles.timezone"),
			pronouns: tableCol("user_profiles.pronouns"),
		},
		tenantMembers: {
			tenant_id: tableCol("tenant_members.tenant_id"),
			principal_id: tableCol("tenant_members.principal_id"),
			principal_type: tableCol("tenant_members.principal_type"),
			role: tableCol("tenant_members.role"),
			status: tableCol("tenant_members.status"),
		},
	};
});

// ─── Mock authenticate() ─────────────────────────────────────────────────────

const { authMockImpl } = vi.hoisted(() => ({
	authMockImpl: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
	authenticate: authMockImpl,
}));

// ─── Mock regenerateManifest to a noop ───────────────────────────────────────

vi.mock("../lib/workspace-manifest.js", () => ({
	regenerateManifest: vi.fn().mockResolvedValue(undefined),
}));

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);

process.env.WORKSPACE_BUCKET = "test-bucket";
process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_APP_CLIENT_IDS = "test-client";

// Import handler AFTER mocks.
import { handler } from "../../workspace-files.js";
import { clearComposerCacheForTests } from "../lib/workspace-overlay.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_A = "tenant-a-id";
const TENANT_B = "tenant-b-id";
const AGENT_ID = "agent-marco-id";
const TEMPLATE_ID = "template-exec-id";
const USER_ID = "user-eric-id";
const EMAIL = "eric@acme.com";

function event(body: Record<string, unknown>, authed = true) {
	return {
		headers: authed
			? { authorization: "Bearer fake-jwt", "content-type": "application/json" }
			: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

function authOk(overrides: { tenantId?: string | null; email?: string | null } = {}) {
	return {
		principalId: USER_ID,
		tenantId: overrides.tenantId ?? TENANT_A,
		email: overrides.email ?? EMAIL,
		authType: "cognito" as const,
	};
}

function agentRow(overrides: Record<string, unknown> = {}) {
	return {
		id: AGENT_ID,
		slug: "marco",
		name: "Marco",
		tenant_id: TENANT_A,
		template_id: TEMPLATE_ID,
		human_pair_id: null,
		agent_pinned_versions: null,
		...overrides,
	};
}

function templateRowTenantA() {
	return { id: TEMPLATE_ID, slug: "exec-assistant", tenant_id: TENANT_A };
}

function tenantRow(id = TENANT_A, slug = "acme", name = "Acme") {
	return { id, slug, name };
}

function body(content: string) {
	return {
		Body: {
			transformToString: async (_enc?: string) => content,
		} as unknown as never,
	};
}

function noSuchKey() {
	const err = new Error("NoSuchKey");
	err.name = "NoSuchKey";
	return err;
}

async function parse(result: { statusCode: number; body: string }) {
	return { statusCode: result.statusCode, body: JSON.parse(result.body) };
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
	s3Mock.reset();
	resetDbQueue();
	clearComposerCacheForTests();
	authMockImpl.mockReset();
});

afterEach(() => {
	// Soft assertion: some tests may leave extra rows queued intentionally
	// (e.g. 401 short-circuits before any DB call). Suppress unless we
	// set STRICT.
});

// ─── 1. Auth boundary ────────────────────────────────────────────────────────

describe("auth boundary", () => {
	it("returns 401 when no JWT is provided", async () => {
		authMockImpl.mockResolvedValue(null);
		const res = await parse(await handler(event({ action: "list", agentId: AGENT_ID }, false)));
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toMatch(/Unauthorized/);
	});

	it("returns 401 when the JWT verifier rejects the token", async () => {
		authMockImpl.mockResolvedValue(null);
		const res = await parse(await handler(event({ action: "list", agentId: AGENT_ID })));
		expect(res.statusCode).toBe(401);
	});

	it("returns 401 when caller's tenant cannot be resolved from JWT or email", async () => {
		authMockImpl.mockResolvedValue({
			principalId: USER_ID,
			tenantId: null,
			email: null,
			authType: "cognito",
		});
		// resolveCallerFromAuth: byId lookup returns empty, no email fallback.
		pushDbRows([]);
		const res = await parse(await handler(event({ action: "list", agentId: AGENT_ID })));
		expect(res.statusCode).toBe(401);
		expect(res.body.error).toMatch(/caller tenant/i);
	});
});

// ─── 2. Legacy body shape rejection ──────────────────────────────────────────

describe("legacy body shape", () => {
	it("rejects requests that include tenantSlug (cross-tenant isolation guard)", async () => {
		authMockImpl.mockResolvedValue(authOk());
		const res = await parse(
			await handler(
				event({
					action: "list",
					tenantSlug: "acme",
					instanceId: "marco",
				}),
			),
		);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toMatch(/tenantSlug.*instanceId/);
	});

	it("rejects instanceId alone too", async () => {
		authMockImpl.mockResolvedValue(authOk());
		const res = await parse(
			await handler(event({ action: "list", instanceId: "marco" })),
		);
		expect(res.statusCode).toBe(400);
	});
});

// ─── 2b. Service-to-service (apikey) auth ────────────────────────────────────

describe("apikey auth (Strands container path, Unit 7)", () => {
	it("accepts apikey auth with an x-tenant-id header and composes the agent", async () => {
		// apikey callers skip the DB users lookup entirely — resolveCallerFromAuth
		// trusts the x-tenant-id header since the shared service secret is the
		// trust boundary.
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: TENANT_A,
			email: null,
			authType: "apikey",
		});
		// resolveAgentTarget
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		// composer.loadAgentContext
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([templateRowTenantA()]);

		s3Mock.on(GetObjectCommand, { Key: "tenants/acme/agents/marco/workspace/SOUL.md" }).rejects(noSuchKey());
		s3Mock.on(GetObjectCommand, { Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/SOUL.md" }).rejects(noSuchKey());
		s3Mock.on(GetObjectCommand, { Key: "tenants/acme/agents/_catalog/defaults/workspace/SOUL.md" })
			.resolves({ Body: { transformToString: async () => "Hi {{AGENT_NAME}}" } as unknown as never });

		const res = await parse(
			await handler(event({ action: "get", agentId: AGENT_ID, path: "SOUL.md" })),
		);
		expect(res.statusCode).toBe(200);
		expect(res.body.content).toBe("Hi Marco");
	});

	it("returns 404 when apikey caller's x-tenant-id does not match the agent's tenant", async () => {
		// Strands container running in tenant B accidentally passes an agentId
		// belonging to tenant A. The composer's DB lookup binds both and
		// returns nothing.
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: TENANT_B,
			email: null,
			authType: "apikey",
		});
		// resolveAgentTarget: agent belongs to A, mismatches caller's B → null
		pushDbRows([agentRow({ tenant_id: TENANT_A })]);

		const res = await parse(
			await handler(event({ action: "get", agentId: AGENT_ID, path: "SOUL.md" })),
		);
		expect(res.statusCode).toBe(404);
		expect(s3Mock.calls().length).toBe(0);
	});

	it("rejects apikey without any x-tenant-id header (caller tenant unresolvable)", async () => {
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: null,
			email: null,
			authType: "apikey",
		});
		const res = await parse(
			await handler(event({ action: "list", agentId: AGENT_ID })),
		);
		expect(res.statusCode).toBe(401);
	});
});

// ─── 3. Target selection ─────────────────────────────────────────────────────

describe("target selection", () => {
	it("requires exactly one of agentId / templateId / defaults", async () => {
		authMockImpl.mockResolvedValue(authOk());
		// resolveCallerFromAuth: byId lookup hits users table first.
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		const res = await parse(await handler(event({ action: "list" })));
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toMatch(/Exactly one/);
	});

	it("rejects multiple target selectors", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		const res = await parse(
			await handler(event({ action: "list", agentId: AGENT_ID, templateId: TEMPLATE_ID })),
		);
		expect(res.statusCode).toBe(400);
	});
});

// ─── 4. Cross-tenant isolation via agentId ───────────────────────────────────

describe("cross-tenant isolation", () => {
	it("returns 404 when caller's tenant does not match the agent's tenant", async () => {
		// Caller is in TENANT_B, but agent lives in TENANT_A.
		authMockImpl.mockResolvedValue(authOk({ tenantId: TENANT_B }));
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_B }]); // resolveCallerFromAuth
		// resolveAgentTarget queries agents by id; our agent belongs to TENANT_A.
		pushDbRows([agentRow({ tenant_id: TENANT_A })]);
		// resolveAgentTarget checks tenant_id !== tenantId → returns null.

		const res = await parse(
			await handler(event({ action: "list", agentId: AGENT_ID })),
		);
		expect(res.statusCode).toBe(404);
		expect(res.body.error).toMatch(/Target not found/);
		// No S3 reads should have happened.
		expect(s3Mock.calls().length).toBe(0);
	});
});

// ─── 5. Agent GET / LIST via composer ────────────────────────────────────────

describe("agent GET / LIST", () => {
	it("GET routes through the composer and returns { content, source, sha256 }", async () => {
		authMockImpl.mockResolvedValue(authOk());
		// resolveCallerFromAuth
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		// resolveAgentTarget: agents lookup
		pushDbRows([agentRow()]);
		// resolveAgentTarget: tenants lookup
		pushDbRows([tenantRow()]);
		// composer.loadAgentContext: agents → tenants → templates
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([templateRowTenantA()]);

		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/marco/workspace/IDENTITY.md",
			})
			.rejects(noSuchKey());
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/IDENTITY.md",
			})
			.rejects(noSuchKey());
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/defaults/workspace/IDENTITY.md",
			})
			.resolves(body("Your name is {{AGENT_NAME}}."));

		const res = await parse(
			await handler(event({ action: "get", agentId: AGENT_ID, path: "IDENTITY.md" })),
		);

		expect(res.statusCode).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.source).toBe("defaults");
		expect(res.body.content).toBe("Your name is Marco.");
		expect(typeof res.body.sha256).toBe("string");
	});
});

// ─── 6. Pinned-file write guard ──────────────────────────────────────────────

describe("pinned-file write guard", () => {
	it("PUT on GUARDRAILS.md via agentId without acceptTemplateUpdate → 403", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
		pushDbRows([agentRow()]); // resolveAgentTarget: agents
		pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
		pushDbRows([{ role: "admin" }]); // callerIsTenantAdmin (U31)

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "GUARDRAILS.md",
					content: "# clobber",
				}),
			),
		);

		expect(res.statusCode).toBe(403);
		expect(res.body.error).toMatch(/pinned/i);
		expect(res.body.error).toMatch(/acceptTemplateUpdate/);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
	});

	it("PUT on GUARDRAILS.md with acceptTemplateUpdate: true → 200", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "admin" }]); // U31 role gate
		s3Mock.on(PutObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "GUARDRAILS.md",
					content: "# accepted",
					acceptTemplateUpdate: true,
				}),
			),
		);

		expect(res.statusCode).toBe(200);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
	});

	it("PUT on a live file (IDENTITY.md) does NOT require acceptTemplateUpdate", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "admin" }]); // U31 role gate
		s3Mock.on(PutObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "IDENTITY.md",
					content: "override",
				}),
			),
		);

		expect(res.statusCode).toBe(200);
	});
});

// ─── 7. DELETE ───────────────────────────────────────────────────────────────

describe("agent DELETE", () => {
	it("deletes the agent-scoped override and returns 200", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "admin" }]); // U31 role gate
		s3Mock.on(DeleteObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
			),
		);

		expect(res.statusCode).toBe(200);
		const calls = s3Mock.commandCalls(DeleteObjectCommand);
		expect(calls.length).toBe(1);
		expect(calls[0].args[0].input.Key).toBe(
			"tenants/acme/agents/marco/workspace/IDENTITY.md",
		);
	});
});

// ─── 8. Template target ──────────────────────────────────────────────────────

describe("template target", () => {
	it("LIST on templateId lists template prefix directly, not via composer", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
		pushDbRows([templateRowTenantA()]); // resolveTemplateTarget: templates
		pushDbRows([tenantRow()]); // resolveTemplateTarget: tenants
		s3Mock.on(ListObjectsV2Command).resolves({
			Contents: [
				{ Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/IDENTITY.md" },
				{ Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/manifest.json" },
			],
		});

		const res = await parse(
			await handler(event({ action: "list", templateId: TEMPLATE_ID })),
		);

		expect(res.statusCode).toBe(200);
		expect(res.body.files).toEqual([
			{ path: "IDENTITY.md", source: "template", sha256: "", overridden: false },
		]);
	});

	it("rejects a template owned by a different tenant with 404", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		// resolveTemplateTarget: template lookup returns a row for TENANT_B.
		pushDbRows([{ id: TEMPLATE_ID, slug: "other-template", tenant_id: TENANT_B }]);

		const res = await parse(
			await handler(event({ action: "list", templateId: TEMPLATE_ID })),
		);
		expect(res.statusCode).toBe(404);
		expect(s3Mock.calls().length).toBe(0);
	});
});

// ─── 8b. includeContent: the Unit 7 Strands cold-start contract ──────────────

describe("list action includeContent (Strands container cold-start)", () => {
	it("returns files[].content when includeContent=true (container bootstrap)", async () => {
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: TENANT_A,
			email: null,
			authType: "apikey",
		});
		// resolveAgentTarget
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		// composer.loadAgentContext
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([templateRowTenantA()]);

		// composeList includeContent walks S3 for each canonical path. Stub
		// every attempt to 404 except defaults for SOUL.md so composeList
		// produces at least one composed entry with content.
		s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
		s3Mock.on(GetObjectCommand).rejects(noSuchKey());
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/defaults/workspace/SOUL.md",
			})
			.resolves({
				Body: { transformToString: async () => "Hi {{AGENT_NAME}}" } as unknown as never,
			});

		const res = await parse(
			await handler(
				event({ action: "list", agentId: AGENT_ID, includeContent: true }),
			),
		);
		expect(res.statusCode).toBe(200);
		const soul = res.body.files.find((f: { path: string }) => f.path === "SOUL.md");
		expect(soul).toBeDefined();
		expect(soul.content).toBe("Hi Marco");
	});

	it("omits files[].content when includeContent is absent or false", async () => {
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: TENANT_A,
			email: null,
			authType: "apikey",
		});
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([templateRowTenantA()]);

		s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
		s3Mock.on(HeadObjectCommand).rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } } as never);

		const res = await parse(
			await handler(event({ action: "list", agentId: AGENT_ID })),
		);
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.body.files)).toBe(true);
		for (const f of res.body.files) {
			expect(f.content).toBeUndefined();
		}
	});
});

// ─── 8c. CORS preflight + headers on every response ─────────────────────────

describe("CORS", () => {
	it("short-circuits OPTIONS preflight with 204 + CORS headers before auth", async () => {
		// No auth mock set up — if the handler hit authenticate() it would
		// return 401 and this test would fail.
		authMockImpl.mockResolvedValue(null);
		const preflight = await handler({
			headers: {
				origin: "http://localhost:5175",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization, content-type",
			},
			requestContext: { http: { method: "OPTIONS" } },
			body: null,
		});
		expect(preflight.statusCode).toBe(204);
		expect(preflight.headers?.["Access-Control-Allow-Origin"]).toBe("*");
		expect(preflight.headers?.["Access-Control-Allow-Methods"]).toMatch(/POST/);
		expect(preflight.headers?.["Access-Control-Allow-Headers"]).toMatch(
			/authorization/i,
		);
	});

	it("emits Access-Control-Allow-Origin on normal POST responses too", async () => {
		authMockImpl.mockResolvedValue(null);
		const res = await handler({
			headers: {},
			body: JSON.stringify({ action: "list", agentId: AGENT_ID }),
		});
		// 401 (no auth) but CORS headers must still be present or the
		// browser won't even expose the response body to the admin UI.
		expect(res.statusCode).toBe(401);
		expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
	});
});

// ─── 9. Action validation ────────────────────────────────────────────────────

describe("action validation", () => {
	it("rejects unknown actions", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		const res = await parse(
			await handler(event({ action: "evil", agentId: AGENT_ID })),
		);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toMatch(/Unknown action/);
	});
});

// ─── 10. U31: tenant admin/owner role gate on writes ────────────────────────

describe("U31 role gate (tenant admin/owner required for writes)", () => {
	it("PUT by a member-role caller (not admin/owner) → 403, no S3 write", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
		pushDbRows([agentRow()]); // resolveAgentTarget: agents
		pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
		pushDbRows([{ role: "member" }]); // callerIsTenantAdmin: not admin

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "IDENTITY.md",
					content: "override-attempt",
				}),
			),
		);

		expect(res.statusCode).toBe(403);
		expect(res.body.error).toMatch(/admin or owner/i);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
	});

	it("PUT by a caller with no membership row → 403", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([]); // callerIsTenantAdmin: no membership row

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "IDENTITY.md",
					content: "override-attempt",
				}),
			),
		);

		expect(res.statusCode).toBe(403);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
	});

	it("DELETE by a member-role caller → 403", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "member" }]);

		const res = await parse(
			await handler(
				event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
			),
		);

		expect(res.statusCode).toBe(403);
		expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
	});

	it("regenerate-map by a member-role caller → 403", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "member" }]);

		const res = await parse(
			await handler(event({ action: "regenerate-map", agentId: AGENT_ID })),
		);

		expect(res.statusCode).toBe(403);
	});

	it("update-identity-field by a member-role caller → 403", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "member" }]);

		const res = await parse(
			await handler(
				event({
					action: "update-identity-field",
					agentId: AGENT_ID,
					field: "creature",
					value: "axolotl",
				}),
			),
		);

		expect(res.statusCode).toBe(403);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
	});

	it("GET by a member-role caller still succeeds (reads stay open)", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
		pushDbRows([agentRow()]); // resolveAgentTarget: agents
		pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
		// NOTE: no tenantMembers row queued — read path must not query it.
		pushDbRows([agentRow()]); // composer.loadAgentContext: agents
		pushDbRows([tenantRow()]); // composer.loadAgentContext: tenants
		pushDbRows([templateRowTenantA()]); // composer.loadAgentContext: templates

		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/marco/workspace/IDENTITY.md",
			})
			.rejects(noSuchKey());
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/IDENTITY.md",
			})
			.rejects(noSuchKey());
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/defaults/workspace/IDENTITY.md",
			})
			.resolves(body("Your name is {{AGENT_NAME}}."));

		const res = await parse(
			await handler(event({ action: "get", agentId: AGENT_ID, path: "IDENTITY.md" })),
		);
		expect(res.statusCode).toBe(200);
	});

	it("LIST by a member-role caller still succeeds (reads stay open)", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([templateRowTenantA()]);
		pushDbRows([tenantRow()]);
		s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

		const res = await parse(
			await handler(event({ action: "list", templateId: TEMPLATE_ID })),
		);
		expect(res.statusCode).toBe(200);
	});

	it("apikey caller bypasses the role check on writes (platform-credential trust)", async () => {
		// Strands container path: shared service secret is the trust
		// boundary; per-tenant role doesn't apply.
		authMockImpl.mockResolvedValue({
			principalId: null,
			tenantId: TENANT_A,
			email: null,
			authType: "apikey",
		});
		pushDbRows([agentRow()]); // resolveAgentTarget: agents
		pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
		// NO tenantMembers row queued — apikey path must short-circuit
		// before calling callerIsTenantAdmin.
		s3Mock.on(PutObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({
					action: "put",
					agentId: AGENT_ID,
					path: "IDENTITY.md",
					content: "service-write",
				}),
			),
		);
		expect(res.statusCode).toBe(200);
		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
	});

	it("admin role passes the gate", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "admin" }]);
		s3Mock.on(DeleteObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
			),
		);
		expect(res.statusCode).toBe(200);
	});

	it("owner role passes the gate", async () => {
		authMockImpl.mockResolvedValue(authOk());
		pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
		pushDbRows([agentRow()]);
		pushDbRows([tenantRow()]);
		pushDbRows([{ role: "owner" }]);
		s3Mock.on(DeleteObjectCommand).resolves({});

		const res = await parse(
			await handler(
				event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
			),
		);
		expect(res.statusCode).toBe(200);
	});
});
