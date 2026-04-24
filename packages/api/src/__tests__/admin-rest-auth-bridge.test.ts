/**
 * Admin REST auth-bridge test (Unit U7d).
 *
 * Every REST handler that previously gated on the baked API secret now
 * runs through `authenticate()` from `../lib/cognito-auth.js`, which
 * accepts three credential shapes:
 *
 *   1. Cognito JWT via Authorization: Bearer <jwt>
 *   2. Service secret via x-api-key
 *   3. Service secret via Authorization: Bearer <secret>  (CLI/Strands back-compat)
 *
 * This test asserts the gate behaves identically across all 14 handlers
 * updated in U7a/U7b/U7c. We don't exercise business logic; we only
 * check that the gate returns 401 for no credential and something
 * non-401 (200/400/404/500 — anything but 401) for each accepted
 * credential. Handler bodies are allowed to fail after the gate because
 * the DB layer is stubbed — that failure surfaces as a 5xx/4xx, not
 * 401, which is exactly what we want to prove.
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

// Stub the DB layer so handler bodies don't attempt real Aurora traffic.
// We return a chainable proxy whose every method call returns the same
// proxy, and whose `.then` rejects. Handlers await the query at the end
// of the chain, the rejection surfaces inside the handler's try/catch,
// and they return a 5xx. The test cares only that we cross the gate —
// a 5xx counts as non-401. Declared via vi.hoisted so it's constructed
// before vi.mock factories (which vitest hoists above module imports).
const { rejectingDbProxy } = vi.hoisted(() => {
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
	return { rejectingDbProxy: makeProxy() };
});

vi.mock("@thinkwork/database-pg", async () => {
	const schema = await vi.importActual<any>("@thinkwork/database-pg/schema");
	return {
		getDb: () => rejectingDbProxy,
		schema,
		ensureThreadForWork: async () => {
			throw new Error("[test-stub] ensureThreadForWork called");
		},
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
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE";
	body?: string;
}

/**
 * Every handler picks a route that:
 *   - is protected by the auth gate (not a public pre-gate route), and
 *   - exits as early as possible after the gate (ideally without touching DB).
 * Post-gate DB calls return 4xx/5xx via the rejecting proxy; the test only
 * asserts the status is NOT 401.
 */
const CASES: HandlerCase[] = [
	{ name: "activity", fn: activity, path: "/api/activity", method: "GET" },
	{ name: "agents", fn: agents, path: "/api/agents", method: "GET" },
	{
		name: "agent-actions",
		fn: agentActions,
		path: "/api/agents/00000000-0000-0000-0000-000000000001/heartbeat",
		method: "POST",
		body: "{}",
	},
	{
		name: "budgets",
		fn: budgets,
		path: "/api/budgets/tenant",
		method: "GET",
	},
	{
		name: "connections",
		fn: connections,
		path: "/api/connections",
		method: "GET",
	},
	{
		name: "guardrails-handler",
		fn: guardrails,
		path: "/api/guardrails",
		method: "GET",
	},
	{
		// Authenticated invites route (list join requests). Public routes
		// (/api/invites/:token and /api/invites/:token/accept) sit above
		// the gate and must not be used here.
		name: "invites",
		fn: invites,
		path: "/api/tenants/00000000-0000-0000-0000-000000000001/join-requests",
		method: "GET",
	},
	{
		name: "routines",
		fn: routines,
		path: "/api/routines",
		method: "GET",
	},
	{
		name: "scheduled-jobs",
		fn: scheduledJobs,
		path: "/api/scheduled-jobs",
		method: "GET",
	},
	{
		// Non-mcp-oauth path so we hit the gate rather than the public
		// OAuth callback branch above it.
		name: "skills",
		fn: skills,
		path: "/api/skills/catalog",
		method: "GET",
	},
	{
		name: "team-members",
		fn: teamMembers,
		path: "/api/teams/00000000-0000-0000-0000-000000000001/agents",
		method: "GET",
	},
	{ name: "teams", fn: teams, path: "/api/teams", method: "GET" },
	{ name: "tenants", fn: tenants, path: "/api/tenants", method: "GET" },
	{
		name: "webhooks-admin",
		fn: webhooksAdmin,
		path: "/api/webhooks",
		method: "GET",
	},
];

function makeEvent(
	c: HandlerCase,
	headers: Record<string, string | undefined>,
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: "$default",
		rawPath: c.path,
		rawQueryString: "",
		headers: headers as Record<string, string>,
		requestContext: {
			accountId: "000000000000",
			apiId: "test",
			domainName: "test.local",
			domainPrefix: "test",
			http: {
				method: c.method,
				path: c.path,
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
		body: c.body,
		isBase64Encoded: false,
	} as APIGatewayProxyEventV2;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin REST auth bridge — 14 handlers accept the three credential shapes", () => {
	const prevSecret = process.env.API_AUTH_SECRET;
	const prevPool = process.env.COGNITO_USER_POOL_ID;
	const prevClients = process.env.COGNITO_APP_CLIENT_IDS;

	beforeEach(() => {
		process.env.API_AUTH_SECRET = "tw-test-secret";
		process.env.COGNITO_USER_POOL_ID = "us-east-1_test";
		process.env.COGNITO_APP_CLIENT_IDS = "test-client";
		// Reset to "accept" stance by default; each test overrides per case.
		mockVerifyImpl.fn = (_token: string) =>
			Promise.resolve({
				sub: "user-test",
				email: "test@example.com",
				"custom:tenant_id": "tenant-abc",
			}) as Promise<any>;
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
	 * the 401 short-circuit. An error thrown from the stubbed DB layer is
	 * proof the code ran past the gate. Treat "gate passed" as either a
	 * non-401 response or a raised DB-stub rejection.
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
				// post-gate failure (500-equivalent), which is non-401.
				return 500;
			}
			throw err;
		}
	}

	for (const c of CASES) {
		describe(c.name, () => {
			it("crosses the gate with a valid Cognito JWT (Authorization: Bearer <jwt>)", async () => {
				// Verifier stub resolves → gate treats it as cognito auth.
				const status = await statusOrNon401(
					c.fn,
					makeEvent(c, {
						authorization: "Bearer fake.jwt.token",
						"x-tenant-id": "tenant-abc",
					}),
				);
				expect(status).not.toBe(401);
			});

			it("crosses the gate with Authorization: Bearer <API_AUTH_SECRET>", async () => {
				// No JWT path: verifier throws → falls through to Bearer-as-apikey.
				mockVerifyImpl.fn = () => Promise.reject(new Error("not a jwt"));
				const status = await statusOrNon401(
					c.fn,
					makeEvent(c, {
						authorization: "Bearer tw-test-secret",
						"x-tenant-id": "tenant-abc",
					}),
				);
				expect(status).not.toBe(401);
			});

			it("crosses the gate with x-api-key: <API_AUTH_SECRET>", async () => {
				const status = await statusOrNon401(
					c.fn,
					makeEvent(c, {
						"x-api-key": "tw-test-secret",
						"x-tenant-id": "tenant-abc",
					}),
				);
				expect(status).not.toBe(401);
			});

			it("returns 401 when no auth headers are present", async () => {
				mockVerifyImpl.fn = () => Promise.reject(new Error("no jwt"));
				const res = await c.fn(
					makeEvent(c, {
						"x-tenant-id": "tenant-abc",
					}),
				);
				expect(res.statusCode).toBe(401);
			});
		});
	}
});
