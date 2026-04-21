/**
 * Tests for `packages/api/src/handlers/webhooks/_shared.ts` — the shared
 * webhook ingress helper (Unit 8).
 *
 * Covered:
 *   * happy path: valid signature + resolver → inserts row + invokes comp → 200
 *   * bad signature → 401 with no tenant enumeration in the body
 *   * unknown tenant (URL path doesn't match any secret) → 401
 *   * malformed path (missing tenantId segment) → 401
 *   * resolver returns ok+skip → 200 skipped, no row inserted
 *   * resolver returns ok=false → maps to resolver-specified status
 *   * dedup: second identical webhook while first is running → 200 deduped
 *   * invoke failure → row → failed + 502
 *   * actor identity — caller-supplied actor in the payload is ignored; the
 *     server always uses the tenant system user from the bootstrap helper
 *   * rate limit (>60/min per tenant+integration) → 429
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHmac } from "node:crypto";

const {
	mockSelect,
	mockInsert,
	mockUpdate,
	mockInvokeComposition,
	mockHashResolvedInputs,
	mockFetchSigningSecret,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockInsert: vi.fn(),
	mockUpdate: vi.fn(),
	mockInvokeComposition: vi.fn(),
	mockHashResolvedInputs: vi.fn(() => "hash-fixed"),
	mockFetchSigningSecret: vi.fn(),
}));

type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
});

const insertChain = (rows: Rows) => ({
	values: () => ({
		onConflictDoNothing: () => ({
			returning: () => Promise.resolve(rows),
		}),
		returning: () => Promise.resolve(rows),
	}),
});

const updateChain = () => ({
	set: () => ({ where: () => Promise.resolve() }),
});

vi.mock("../lib/db.js", () => ({
	db: {
		select: () => selectChain((mockSelect() as Rows) ?? []),
		insert: () => insertChain((mockInsert() as Rows) ?? []),
		update: () => {
			mockUpdate();
			return updateChain();
		},
	},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	skillRuns: {
		id: "skill_runs.id",
		tenant_id: "skill_runs.tenant_id",
		invoker_user_id: "skill_runs.invoker_user_id",
		skill_id: "skill_runs.skill_id",
		resolved_inputs_hash: "skill_runs.resolved_inputs_hash",
		status: "skill_runs.status",
	},
	tenantSystemUsers: {
		id: "tenant_system_users.id",
		tenant_id: "tenant_system_users.tenant_id",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => ({ _and: a }),
	eq: (...a: unknown[]) => ({ _eq: a }),
	sql: (...a: unknown[]) => ({ _sql: a }),
}));

vi.mock("../graphql/utils.js", () => ({
	hashResolvedInputs: mockHashResolvedInputs,
	invokeComposition: mockInvokeComposition,
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn().mockImplementation(() => ({
		send: vi.fn(),
	})),
	GetSecretValueCommand: vi.fn(),
	ResourceNotFoundException: class ResourceNotFoundException extends Error {},
}));

// Helper: queue the tenant_system_users lookup BEFORE the test's own
// select/insert queues. Every webhook call hits the bootstrap first, so
// tests that exercise the happy path prepend this.
const SYSTEM_USER = "system-user-1";

const {
	createWebhookHandler,
	signingSecretName,
	__resetRateLimitForTests,
} = await import("../handlers/webhooks/_shared.js");

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "super-secret";

function makeEvent(
	rawBody: string,
	opts: {
		path?: string;
		signature?: string;
		method?: string;
		isBase64Encoded?: boolean;
	} = {},
): APIGatewayProxyEventV2 {
	const body = rawBody;
	const sig =
		opts.signature ??
		`sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
	const path = opts.path ?? `/webhooks/test-integration/${TENANT_ID}`;
	return {
		version: "2.0",
		routeKey: "POST /webhooks/{integration}/{tenantId}",
		rawPath: path,
		rawQueryString: "",
		headers: {
			"content-type": "application/json",
			"x-thinkwork-signature": sig,
		},
		requestContext: {
			http: {
				method: opts.method ?? "POST",
				path,
				sourceIp: "",
				userAgent: "",
			},
		} as APIGatewayProxyEventV2["requestContext"],
		body,
		isBase64Encoded: !!opts.isBase64Encoded,
	};
}

const ALWAYS_OK_RESOLVER = async () =>
	({
		ok: true as const,
		skillId: "customer-onboarding-reconciler",
		inputs: { customerId: "cust-1" },
	});

const makeHandler = (
	resolve: Parameters<typeof createWebhookHandler>[0]["resolve"] = ALWAYS_OK_RESOLVER,
) =>
	createWebhookHandler(
		{ integration: "test-integration", resolve },
		{ fetchSigningSecret: mockFetchSigningSecret },
	);

beforeEach(() => {
	vi.resetAllMocks();
	mockHashResolvedInputs.mockReturnValue("hash-fixed");
	mockFetchSigningSecret.mockResolvedValue(SECRET);
	mockInvokeComposition.mockResolvedValue({ ok: true });
	__resetRateLimitForTests();
});

// Reusable: queue the two consecutive reads + an insert that
// `ensureTenantSystemUser` walks in the happy path:
//   1. SELECT from tenant_system_users WHERE tenant = :t  → return existing row
// A return of `[{id: SYSTEM_USER}]` short-circuits the helper before the
// second SELECT/insert path, which keeps each test's DB mock queue small.
function queueSystemUserBootstrap() {
	mockSelect.mockReturnValueOnce([{ id: SYSTEM_USER }]);
}

describe("signingSecretName", () => {
	it("matches the tenant+integration path convention from the plan", () => {
		expect(signingSecretName("t-1", "crm-opportunity")).toBe(
			"thinkwork/tenants/t-1/webhooks/crm-opportunity/signing-secret",
		);
	});
});

describe("webhook happy path", () => {
	it("inserts a running skill_runs row and invokes composition", async () => {
		const handler = makeHandler();
		const rawBody = JSON.stringify({ customerId: "cust-1" });
		queueSystemUserBootstrap();
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);

		const res = await handler(makeEvent(rawBody));

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.runId).toBe("run-1");
		expect(body.deduped).toBe(false);
		expect(mockInvokeComposition).toHaveBeenCalledTimes(1);
		const envelope = mockInvokeComposition.mock.calls[0][0];
		expect(envelope).toMatchObject({
			kind: "run_skill",
			invocationSource: "webhook",
			tenantId: TENANT_ID,
			invokerUserId: SYSTEM_USER,
			skillId: "customer-onboarding-reconciler",
		});
	});
});

describe("webhook auth", () => {
	it("rejects bad signatures with 401 and no tenant info in body", async () => {
		const handler = makeHandler();
		const res = await handler(
			makeEvent("{}", { signature: "sha256=deadbeef" }),
		);
		expect(res.statusCode).toBe(401);
		expect((res.body as string).toLowerCase()).not.toContain(TENANT_ID);
	});

	it("rejects missing signature header with 401", async () => {
		const handler = makeHandler();
		const e = makeEvent("{}");
		delete e.headers["x-thinkwork-signature"];
		const res = await handler(e);
		expect(res.statusCode).toBe(401);
	});

	it("rejects unknown tenant (no secret in Secrets Manager) with 401", async () => {
		mockFetchSigningSecret.mockResolvedValue(null);
		const handler = makeHandler();
		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(401);
	});

	it("rejects malformed paths with 401 (no tenantId segment)", async () => {
		const handler = makeHandler();
		const res = await handler(
			makeEvent("{}", { path: "/webhooks/test-integration" }),
		);
		expect(res.statusCode).toBe(401);
	});

	it("rejects non-UUID-shaped tenantId with 401 without probing the secret store", async () => {
		const handler = makeHandler();
		const res = await handler(
			makeEvent("{}", { path: "/webhooks/test-integration/../evil" }),
		);
		expect(res.statusCode).toBe(401);
		expect(mockFetchSigningSecret).not.toHaveBeenCalled();
	});

	it("rejects non-POST methods with 405", async () => {
		const handler = makeHandler();
		const res = await handler(makeEvent("{}", { method: "GET" }));
		expect(res.statusCode).toBe(405);
	});
});

describe("webhook resolver outcomes", () => {
	it("returns 200 {skipped} without inserting a row when resolver says skip", async () => {
		const handler = makeHandler(async () => ({
			ok: true,
			skip: true,
			reason: "not a close-won event",
		}));
		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.skipped).toBe(true);
		expect(body.reason).toContain("close-won");
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it("maps resolver {ok:false, status} to HTTP status", async () => {
		const handler = makeHandler(async () => ({
			ok: false,
			status: 403,
			message: "cross-tenant entity",
		}));
		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(403);
	});

	it("returns 500 when resolver throws (without leaking internals to client)", async () => {
		const handler = makeHandler(async () => {
			throw new Error("db bomb");
		});
		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(500);
		// Body message is generic — internal stack trace MUST NOT appear in
		// response. It logs server-side only.
		expect(res.body as string).not.toContain("db bomb");
	});
});

describe("webhook dedup", () => {
	it("returns {deduped:true} + existing runId when insert yields 0 rows", async () => {
		const handler = makeHandler();
		queueSystemUserBootstrap();
		mockInsert.mockReturnValueOnce([]); // dedup hit
		mockSelect.mockReturnValueOnce([
			{ id: "run-existing", status: "running" },
		]);

		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.runId).toBe("run-existing");
		expect(body.deduped).toBe(true);
		expect(mockInvokeComposition).not.toHaveBeenCalled();
	});

	it("returns 500 when dedup hit + no matching active run (race)", async () => {
		const handler = makeHandler();
		queueSystemUserBootstrap();
		mockInsert.mockReturnValueOnce([]);
		mockSelect.mockReturnValueOnce([]); // no active match either

		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(500);
	});
});

describe("webhook invoke failure", () => {
	it("transitions row to failed and returns 502 when invoke errors", async () => {
		const handler = makeHandler();
		queueSystemUserBootstrap();
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);
		mockInvokeComposition.mockResolvedValueOnce({
			ok: false,
			error: "agentcore threw",
		});

		const res = await handler(makeEvent("{}"));
		expect(res.statusCode).toBe(502);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});
});

describe("webhook actor identity", () => {
	it("ignores any actor field the vendor payload tries to set", async () => {
		const handler = makeHandler(async () => ({
			ok: true,
			skillId: "x",
			inputs: { customerId: "c-1" },
		}));
		// The bootstrap lookup returns the tenant's stable system-user
		// — the actor identity must come from this row, NEVER from the
		// vendor payload.
		mockSelect.mockReturnValueOnce([{ id: "system-actor-SAFE" }]);
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);

		// Payload deliberately includes an "actor" the attacker might hope
		// to pivot on. It must not flow through anywhere.
		const payload = JSON.stringify({
			actor: "victim-user",
			userId: "victim-user",
			event: "opportunity.won",
		});
		const res = await handler(makeEvent(payload));

		expect(res.statusCode).toBe(200);
		const envelope = mockInvokeComposition.mock.calls[0][0];
		expect(envelope.invokerUserId).toBe("system-actor-SAFE");
		expect(envelope.invokerUserId).not.toBe("victim-user");
	});
});

describe("webhook rate limit", () => {
	it("429s the 61st request in a rolling 60s window per (tenant, integration)", async () => {
		const handler = makeHandler();
		// Fresh bootstrap lookup + successful insert for each of the 60
		// under-the-limit requests. The 61st never reaches the DB.
		mockSelect.mockReturnValue([{ id: SYSTEM_USER }]);
		mockInsert.mockReturnValue([{ id: "run-x", skill_version: 1 }]);

		for (let i = 0; i < 60; i++) {
			const res = await handler(makeEvent(`{"i":${i}}`));
			expect(res.statusCode).toBe(200);
		}
		const blocked = await handler(makeEvent(`{"i":60}`));
		expect(blocked.statusCode).toBe(429);
	});
});
