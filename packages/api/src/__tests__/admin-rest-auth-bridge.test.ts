/**
 * Admin REST auth-bridge test (Unit U7d + U4).
 *
 * Every REST handler that previously gated on the baked API secret now
 * runs through `authenticate()` from `../lib/cognito-auth.js` **and**
 * `requireTenantMembership()` from `../lib/tenant-membership.js`. This
 * test asserts both gates behave correctly across the 14 handlers
 * updated in U7a/U7b/U7c/U1/U2/U3.
 *
 * Credential cases, four "gate-crossing" + four "membership-specific":
 *
 *   Existing (PR #522):
 *     1. `cognito-admin`       — valid JWT, membership row with role='owner'
 *                                → gate crossed (non-401/403)
 *     2. `bearer-apisecret`    — Authorization: Bearer <API_AUTH_SECRET>
 *                                → gate crossed (apikey bypass)
 *     3. `x-api-key-apisecret` — x-api-key: <API_AUTH_SECRET>
 *                                → gate crossed (apikey bypass)
 *     4. `no-auth`             — no credentials → 401
 *
 *   New (U4, this file):
 *     5. `cognito-member`      — valid JWT, role='member'. GET on most
 *                                handlers crosses the gate; on budgets
 *                                (financial data, owner/admin for GET)
 *                                returns 403. On mutation routes returns
 *                                403.
 *     6. `cognito-nonmember`   — valid JWT, no tenant_members row.
 *                                → 403 with reason matching /not a member/i.
 *     7. `cognito-wrong-role`  — valid JWT, role='member' on their own
 *                                tenant, calls a mutation route.
 *                                → 403 with reason matching /lacks privilege/i.
 *     8. `cognito-suspended`   — valid JWT, membership row with
 *                                status='suspended'. → 403.
 *
 * Handler bodies are allowed to fail after the gate because the DB layer
 * is stubbed — that failure surfaces as a 5xx/4xx, not 401, which is
 * exactly what we want to prove for "gate crossed" cases.
 *
 * Two handlers (`tenants` on `/api/tenants` GET and `skills` on
 * `/api/skills/catalog` GET) never call `requireTenantMembership` for
 * their representative test route — they gate only on `authenticate()`.
 * For these, every cognito credential case crosses the gate regardless
 * of membership. The `checksMembership: false` flag marks them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub CognitoJwtVerifier so we can control JWT acceptance deterministically.
// The test harness flips `mockVerifyImpl` per-case: accept returns a payload,
// reject throws. `authenticate()` falls through to apikey branches on throw,
// matching production behavior.
const { mockVerifyImpl } = vi.hoisted(() => ({
	mockVerifyImpl: { fn: (_token: string) => Promise.resolve({ sub: "user-test" }) as Promise<any> },
}));

vi.mock("aws-jwt-verify", () => ({
	CognitoJwtVerifier: {
		create: () => ({
			verify: (token: string) => mockVerifyImpl.fn(token),
		}),
	},
}));

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------
// Two layers:
//
//   1. `@thinkwork/database-pg` getDb() — consumed by requireTenantMembership
//      to resolve tenants + membership rows. We return a table-aware stub
//      whose select().from(<table>).where().limit(N) resolves to whichever
//      rows the current test case sets via mockTenantRows / mockMemberRows.
//
//   2. `../lib/db.js` db — consumed by handler bodies post-gate. This is
//      still the rejecting chainable proxy; we only care that the gate
//      was crossed, so a post-gate reject is acceptable and surfaces as
//      a 5xx via statusOrNon401().
//
// The schema mock mirrors tenant-membership.test.ts: bare objects tagged
// with _tableName so the select stub can branch by table.

const {
	rejectingDbProxy,
	mockTenantRows,
	mockMemberRows,
	mockResolveCallerFromAuth,
} = vi.hoisted(() => {
	const REJECTION = new Error("[test-stub] db query rejected");
	const makeProxy = (): any =>
		new Proxy(function () {}, {
			get(_t, prop) {
				if (prop === "then") {
					return (
						_resolve: (v: unknown) => void,
						reject: (e: unknown) => void,
					) => reject(REJECTION);
				}
				if (prop === "catch") {
					return (reject: (e: unknown) => void) => reject(REJECTION);
				}
				if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
					return undefined;
				}
				return makeProxy();
			},
			apply() {
				return makeProxy();
			},
		});
	return {
		rejectingDbProxy: makeProxy(),
		mockTenantRows: vi.fn<() => unknown[]>(),
		mockMemberRows: vi.fn<() => unknown[]>(),
		mockResolveCallerFromAuth: vi.fn(),
	};
});

vi.mock("@thinkwork/database-pg", async () => {
	// Table-aware stub: requireTenantMembership issues two kinds of
	// select chains — one against `tenants` (resolveTenantUuid) and one
	// against `tenantMembers` (membership check). Branch on the
	// _tableName tag the schema mock below attaches.
	//
	// For anything else (handler bodies reading agents/teams/skills/etc.)
	// fall through to the rejecting proxy so the post-gate DB call
	// surfaces as a 5xx, not a TypeError-on-missing-method.
	// Build a Proxy that's table-aware for tenants/tenant_members but falls
	// through to the rejecting proxy for any other shape. This lets
	// requireTenantMembership's queries resolve to controlled rows while
	// arbitrary handler-body queries (agents, teams, skills, webhooks…)
	// still reject, marking "gate crossed, DB not available" as a 5xx.
	const tenantAwareDb: any = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === "select") {
				return (..._args: unknown[]) => ({
					from: (table: { _tableName?: string } | undefined) => {
						if (
							table &&
							(table._tableName === "tenants" ||
								table._tableName === "tenant_members")
						) {
							return {
								where: () => ({
									limit: () =>
										Promise.resolve(
											table._tableName === "tenants"
												? (mockTenantRows() as unknown[])
												: (mockMemberRows() as unknown[]),
										),
								}),
							};
						}
						// Unknown table → let the rejecting proxy handle
						// whatever chain the handler body builds (where,
						// innerJoin, orderBy, execute, await, etc.).
						return rejectingDbProxy;
					},
				});
			}
			// .insert / .update / .delete / .execute / .transaction / …
			// all return the rejecting proxy so post-gate DB writes surface
			// as 5xx rather than TypeErrors for missing methods.
			return (rejectingDbProxy as any)[prop];
		},
	});
	return {
		getDb: () => tenantAwareDb,
		// Handler bodies that import `schema` from @thinkwork/database-pg
		// and reach into real table metadata (e.g. `schema.activityLog`)
		// need actual drizzle tables, so forward the real schema module.
		schema: await vi.importActual<any>("@thinkwork/database-pg/schema"),
		ensureThreadForWork: async () => {
			throw new Error("[test-stub] ensureThreadForWork called");
		},
	};
});

// schema.ts is imported directly by tenant-membership.ts; we override it
// with a minimal shape tagged for the table-aware stub above. Handlers
// that consume `schema` from the package index get the real schema via
// the getDb mock above's importActual.
vi.mock("@thinkwork/database-pg/schema", async () => {
	const actual = await vi.importActual<any>("@thinkwork/database-pg/schema");
	return {
		...actual,
		tenants: { ...actual.tenants, _tableName: "tenants" },
		tenantMembers: { ...actual.tenantMembers, _tableName: "tenant_members" },
	};
});

vi.mock("../lib/db.js", () => ({
	db: rejectingDbProxy,
}));

vi.mock("../lib/thread-helpers.js", () => ({
	ensureThreadForWork: async () => {
		throw new Error("[test-stub] ensureThreadForWork called");
	},
}));

// resolveCallerFromAuth is called inside requireTenantMembership for
// cognito callers to map JWT sub → users.id. Stub it directly so we
// don't have to model the users table in the DB mock.
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", async () => {
	const actual = await vi.importActual<any>(
		"../graphql/resolvers/core/resolve-auth-user.js",
	);
	return {
		...actual,
		resolveCallerFromAuth: mockResolveCallerFromAuth,
	};
});

// ---------------------------------------------------------------------------
// Handlers under test
// ---------------------------------------------------------------------------
// Imported after mocks so module-load `getDb()` calls (teams, team-members,
// skills) resolve to the stubs above.

// eslint-disable-next-line import/first
import { handler as activity } from "../handlers/activity.js";
// eslint-disable-next-line import/first
import { handler as agents } from "../handlers/agents.js";
// eslint-disable-next-line import/first
import { handler as agentActions } from "../handlers/agent-actions.js";
// eslint-disable-next-line import/first
import { handler as budgets } from "../handlers/budgets.js";
// eslint-disable-next-line import/first
import { handler as connections } from "../handlers/connections.js";
// eslint-disable-next-line import/first
import { handler as guardrails } from "../handlers/guardrails-handler.js";
// eslint-disable-next-line import/first
import { handler as invites } from "../handlers/invites.js";
// eslint-disable-next-line import/first
import { handler as routines } from "../handlers/routines.js";
// eslint-disable-next-line import/first
import { handler as scheduledJobs } from "../handlers/scheduled-jobs.js";
// eslint-disable-next-line import/first
import { handler as skills } from "../handlers/skills.js";
// eslint-disable-next-line import/first
import { handler as teamMembers } from "../handlers/team-members.js";
// eslint-disable-next-line import/first
import { handler as teams } from "../handlers/teams.js";
// eslint-disable-next-line import/first
import { handler as tenants } from "../handlers/tenants.js";
// eslint-disable-next-line import/first
import { handler as webhooksAdmin } from "../handlers/webhooks-admin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HandlerFn = (
	event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

interface HandlerCase {
	name: string;
	fn: HandlerFn;
	/** Representative GET-like route (or the primary test route). */
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE";
	body?: string;
	/**
	 * Optional mutation route for `cognito-wrong-role` + member-on-mutation
	 * assertions. Not every handler has an easy-to-reach mutation path —
	 * skip those assertions when this is omitted.
	 */
	mutationPath?: string;
	mutationMethod?: "POST" | "PUT" | "DELETE";
	mutationBody?: string;
	/**
	 * `false` for handlers whose representative test route gates on
	 * `authenticate()` alone (tenants list, skills catalog). For these the
	 * membership-specific credential cases should still cross the gate.
	 * Defaults to `true`.
	 */
	checksMembership?: boolean;
	/**
	 * Role required to cross the gate on the primary test route. Most
	 * handlers let `member` read on GET; a few are owner/admin-only for
	 * everyone:
	 *   - `budgets` (GET) exposes financial data,
	 *   - `invites` (all routes) expose invite PII,
	 *   - `agent-actions` (primary route is POST /heartbeat, a mutation).
	 */
	primaryGateRole?: "member" | "admin";
}

/**
 * Every handler picks a route that:
 *   - is protected by the auth gate (not a public pre-gate route), and
 *   - exits as early as possible after the gate (ideally without touching DB).
 * Post-gate DB calls return 4xx/5xx via the rejecting proxy; "gate crossed"
 * asserts the status is neither 401 (auth) nor 403 (membership).
 */
const CASES: HandlerCase[] = [
	{
		name: "activity",
		fn: activity,
		path: "/api/activity",
		method: "GET",
		mutationPath: "/api/activity",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "agents",
		fn: agents,
		path: "/api/agents",
		method: "GET",
		mutationPath: "/api/agents",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "agent-actions",
		fn: agentActions,
		path: "/api/agents/00000000-0000-0000-0000-000000000001/heartbeat",
		method: "POST",
		body: "{}",
		// The representative route is already a mutation (POST heartbeat)
		// — member role is rejected on the primary path too.
		primaryGateRole: "admin",
		mutationPath: "/api/agents/00000000-0000-0000-0000-000000000001/heartbeat",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "budgets",
		fn: budgets,
		path: "/api/budgets/tenant",
		method: "GET",
		// Budgets gate GET on owner/admin (financial data). Members are 403.
		primaryGateRole: "admin",
	},
	{
		name: "connections",
		fn: connections,
		path: "/api/connections",
		method: "GET",
		mutationPath: "/api/connections",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "guardrails-handler",
		fn: guardrails,
		path: "/api/guardrails",
		method: "GET",
		mutationPath: "/api/guardrails",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		// Authenticated invites route (list join requests). Public routes
		// (/api/invites/:token and /api/invites/:token/accept) sit above
		// the gate and must not be used here. Every invites path gates on
		// owner/admin (invite PII protection), so `member` is 403 even
		// on GET.
		name: "invites",
		fn: invites,
		path: "/api/tenants/00000000-0000-0000-0000-000000000001/join-requests",
		method: "GET",
		primaryGateRole: "admin",
		mutationPath: "/api/tenants/00000000-0000-0000-0000-000000000001/invites",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "routines",
		fn: routines,
		path: "/api/routines",
		method: "GET",
		mutationPath: "/api/routines",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "scheduled-jobs",
		fn: scheduledJobs,
		path: "/api/scheduled-jobs",
		method: "GET",
		mutationPath: "/api/scheduled-jobs",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		// Non-mcp-oauth catalog path; gates on `authenticate()` only, not
		// membership. All cognito cases cross the gate here.
		name: "skills",
		fn: skills,
		path: "/api/skills/catalog",
		method: "GET",
		checksMembership: false,
	},
	{
		name: "team-members",
		fn: teamMembers,
		path: "/api/teams/00000000-0000-0000-0000-000000000001/agents",
		method: "GET",
		mutationPath: "/api/teams/00000000-0000-0000-0000-000000000001/agents",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		name: "teams",
		fn: teams,
		path: "/api/teams",
		method: "GET",
		mutationPath: "/api/teams",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
	{
		// /api/tenants (GET list) gates on `authenticate()` only; filtering
		// by membership happens inside listTenants, not requireTenantMembership.
		// Membership-specific cases cross the gate here.
		name: "tenants",
		fn: tenants,
		path: "/api/tenants",
		method: "GET",
		checksMembership: false,
	},
	{
		name: "webhooks-admin",
		fn: webhooksAdmin,
		path: "/api/webhooks",
		method: "GET",
		mutationPath: "/api/webhooks",
		mutationMethod: "POST",
		mutationBody: "{}",
	},
];

function makeEvent(
	path: string,
	method: "GET" | "POST" | "PUT" | "DELETE",
	body: string | undefined,
	headers: Record<string, string | undefined>,
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: "$default",
		rawPath: path,
		rawQueryString: "",
		headers: headers as Record<string, string>,
		requestContext: {
			accountId: "000000000000",
			apiId: "test",
			domainName: "test.local",
			domainPrefix: "test",
			http: {
				method,
				path,
				protocol: "HTTP/1.1",
				sourceIp: "127.0.0.1",
				userAgent: "vitest",
			},
			requestId: "test",
			routeKey: "$default",
			stage: "test",
			time: new Date().toISOString(),
			timeEpoch: Date.now(),
		},
		body,
		isBase64Encoded: false,
	} as APIGatewayProxyEventV2;
}

function makePrimary(
	c: HandlerCase,
	headers: Record<string, string | undefined>,
): APIGatewayProxyEventV2 {
	return makeEvent(c.path, c.method, c.body, headers);
}

function makeMutation(
	c: HandlerCase,
	headers: Record<string, string | undefined>,
): APIGatewayProxyEventV2 | null {
	if (!c.mutationPath || !c.mutationMethod) return null;
	return makeEvent(c.mutationPath, c.mutationMethod, c.mutationBody, headers);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin REST auth bridge — 14 handlers gate on auth + membership", () => {
	const prevSecret = process.env.API_AUTH_SECRET;
	const prevPool = process.env.COGNITO_USER_POOL_ID;
	const prevClients = process.env.COGNITO_APP_CLIENT_IDS;

	const TENANT_UUID = "00000000-0000-0000-0000-000000000001";
	const USER_UUID = "11111111-1111-1111-1111-111111111111";

	beforeEach(() => {
		process.env.API_AUTH_SECRET = "tw-test-secret";
		process.env.COGNITO_USER_POOL_ID = "us-east-1_test";
		process.env.COGNITO_APP_CLIENT_IDS = "test-client";
		// Default stance: JWT verifier accepts, caller is a known user,
		// tenant exists, and membership is owner/active. Individual cases
		// override the membership row / resolve-caller output.
		mockVerifyImpl.fn = (_token: string) =>
			Promise.resolve({
				sub: "user-test",
				email: "test@example.com",
				"custom:tenant_id": TENANT_UUID,
			}) as Promise<any>;
		mockTenantRows.mockReset();
		mockTenantRows.mockReturnValue([{ id: TENANT_UUID }]);
		mockMemberRows.mockReset();
		mockMemberRows.mockReturnValue([{ role: "owner", status: "active" }]);
		mockResolveCallerFromAuth.mockReset();
		mockResolveCallerFromAuth.mockResolvedValue({
			userId: USER_UUID,
			tenantId: TENANT_UUID,
		});
	});

	afterEach(() => {
		process.env.API_AUTH_SECRET = prevSecret;
		process.env.COGNITO_USER_POOL_ID = prevPool;
		process.env.COGNITO_APP_CLIENT_IDS = prevClients;
	});

	/**
	 * Some handlers wrap post-gate routing in try/catch and convert DB
	 * rejections into 5xx responses; others `return <innerPromise>` so the
	 * rejection escapes the handler's try/catch. For this test we only
	 * care that the gate was crossed — i.e. the handler did not return
	 * 401 (auth) or 403 (membership). An error thrown from the stubbed DB
	 * layer is proof the code ran past the gate. Treat "gate passed" as
	 * either a non-401/403 response or a raised DB-stub rejection.
	 */
	async function statusOrNon401(
		fn: HandlerFn,
		event: APIGatewayProxyEventV2,
	): Promise<number> {
		try {
			const res = await fn(event);
			return res.statusCode ?? 0;
		} catch (err) {
			const msg = (err as Error).message || "";
			if (msg.includes("[test-stub]")) {
				// Execution ran past the gate and hit the stub. Treat as
				// post-gate failure (500-equivalent), which is non-401/403.
				return 500;
			}
			throw err;
		}
	}

	/**
	 * Run the handler and return either the status code or the response
	 * body as a string — useful for reading the `reason` field when the
	 * gate rejects.
	 */
	async function statusAndBody(
		fn: HandlerFn,
		event: APIGatewayProxyEventV2,
	): Promise<{ status: number; body: string }> {
		const res = await fn(event);
		return {
			status: res.statusCode ?? 0,
			body: typeof res.body === "string" ? res.body : "",
		};
	}

	for (const c of CASES) {
		describe(c.name, () => {
			// -----------------------------------------------------------
			// Existing 4 cases — auth gate shape (PR #522).
			// -----------------------------------------------------------

			it("cognito-admin: crosses the gate with a valid Cognito JWT + owner membership", async () => {
				// Default stance: JWT accepts, membership row = owner/active.
				const status = await statusOrNon401(
					c.fn,
					makePrimary(c, {
						authorization: "Bearer fake.jwt.token",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(status).not.toBe(401);
				expect(status).not.toBe(403);
			});

			it("bearer-apisecret: crosses the gate with Authorization: Bearer <API_AUTH_SECRET>", async () => {
				// No JWT path: verifier throws → falls through to Bearer-as-apikey.
				mockVerifyImpl.fn = () => Promise.reject(new Error("not a jwt"));
				const status = await statusOrNon401(
					c.fn,
					makePrimary(c, {
						authorization: "Bearer tw-test-secret",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(status).not.toBe(401);
				expect(status).not.toBe(403);
			});

			it("x-api-key-apisecret: crosses the gate with x-api-key: <API_AUTH_SECRET>", async () => {
				const status = await statusOrNon401(
					c.fn,
					makePrimary(c, {
						"x-api-key": "tw-test-secret",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(status).not.toBe(401);
				expect(status).not.toBe(403);
			});

			it("no-auth: returns 401 when no auth headers are present", async () => {
				mockVerifyImpl.fn = () => Promise.reject(new Error("no jwt"));
				const res = await c.fn(
					makePrimary(c, {
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(res.statusCode).toBe(401);
			});

			// -----------------------------------------------------------
			// New 4 cases — membership semantics (U4).
			// -----------------------------------------------------------

			it("cognito-member: primary route honors the handler's gate role", async () => {
				// Member has an active membership row with role='member'.
				mockMemberRows.mockReturnValue([
					{ role: "member", status: "active" },
				]);
				const status = await statusOrNon401(
					c.fn,
					makePrimary(c, {
						authorization: "Bearer fake.jwt.token",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				if (c.checksMembership === false || c.primaryGateRole !== "admin") {
					// Either the route gates only on authenticate() (tenants
					// list, skills catalog) — membership role is irrelevant —
					// or the handler permits member-role on the primary
					// route (GETs on most handlers). Gate crossed.
					expect(status).not.toBe(401);
					expect(status).not.toBe(403);
				} else {
					// budgets / invites / agent-actions: primary route
					// gates on owner/admin, member is 403.
					expect(status).toBe(403);
				}
			});

			it("cognito-member: mutation route returns 403 for member role", async () => {
				const mutationEvent = makeMutation(c, {
					authorization: "Bearer fake.jwt.token",
					"x-tenant-id": TENANT_UUID,
				});
				if (!mutationEvent || c.checksMembership === false) {
					// No dedicated mutation path to test (e.g. read-only
					// handler wiring) or the handler gates only on
					// authenticate() — skip. Dummy assertion keeps the
					// "test ran" signal obvious.
					expect(true).toBe(true);
					return;
				}
				mockMemberRows.mockReturnValue([
					{ role: "member", status: "active" },
				]);
				const { status, body } = await statusAndBody(c.fn, mutationEvent);
				expect(status).toBe(403);
				expect(body).toMatch(/lacks privilege/i);
			});

			it("cognito-nonmember: returns 403 with /not a member/i", async () => {
				// No membership row in the target tenant.
				mockMemberRows.mockReturnValue([]);
				if (c.checksMembership === false) {
					// Handler doesn't run the membership check; gate crosses
					// on valid JWT alone. Still verify that nothing crashes
					// and we don't surface an unexpected 401.
					const status = await statusOrNon401(
						c.fn,
						makePrimary(c, {
							authorization: "Bearer fake.jwt.token",
							"x-tenant-id": TENANT_UUID,
						}),
					);
					expect(status).not.toBe(401);
					return;
				}
				const { status, body } = await statusAndBody(
					c.fn,
					makePrimary(c, {
						authorization: "Bearer fake.jwt.token",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(status).toBe(403);
				expect(body).toMatch(/not a member/i);
			});

			it("cognito-wrong-role: member calling a mutation returns 403 /lacks privilege/i", async () => {
				const mutationEvent = makeMutation(c, {
					authorization: "Bearer fake.jwt.token",
					"x-tenant-id": TENANT_UUID,
				});
				if (!mutationEvent || c.checksMembership === false) {
					// No mutation path or no membership check — not
					// applicable.
					expect(true).toBe(true);
					return;
				}
				mockMemberRows.mockReturnValue([
					{ role: "member", status: "active" },
				]);
				const { status, body } = await statusAndBody(c.fn, mutationEvent);
				expect(status).toBe(403);
				expect(body).toMatch(/lacks privilege/i);
			});

			it("cognito-suspended: suspended membership returns 403", async () => {
				mockMemberRows.mockReturnValue([
					{ role: "owner", status: "suspended" },
				]);
				if (c.checksMembership === false) {
					// Membership not consulted — gate crosses on valid JWT.
					const status = await statusOrNon401(
						c.fn,
						makePrimary(c, {
							authorization: "Bearer fake.jwt.token",
							"x-tenant-id": TENANT_UUID,
						}),
					);
					expect(status).not.toBe(401);
					return;
				}
				const res = await c.fn(
					makePrimary(c, {
						authorization: "Bearer fake.jwt.token",
						"x-tenant-id": TENANT_UUID,
					}),
				);
				expect(res.statusCode).toBe(403);
			});
		});
	}
});
