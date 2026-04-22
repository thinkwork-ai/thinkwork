/**
 * Tests for POST /api/skills/complete — terminal-state writeback from
 * the agentcore container.
 *
 * Covered:
 *   * happy path: status=failed + failureReason → row updated, 200
 *   * happy path: status=complete + deliveredArtifactRef → row updated, 200
 *   * unauth: no token / wrong token → 401
 *   * validation: missing fields / invalid status / missing failureReason → 400
 *   * row not found → 404
 *   * tenant mismatch → 403
 *   * invalid transition (already terminal) → 400
 *   * HMAC: missing signature → 401; wrong signature → 401; valid → 200
 *   * HMAC: already-terminated row (secret burned to NULL) → 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
	mockSelect,
	mockUpdate,
	mockUpdateReturning,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockUpdate: vi.fn(),
	mockUpdateReturning: vi.fn(),
}));

type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
});

const updateChain = (returnRows: Rows) => ({
	set: () => ({
		where: () => ({
			returning: () => Promise.resolve(returnRows),
		}),
	}),
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		select: () => selectChain((mockSelect() as Rows) ?? []),
		update: () => {
			mockUpdate();
			return updateChain((mockUpdateReturning() as Rows) ?? []);
		},
		insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }) }) }),
	}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	agentSkills: {},
	skillCatalog: {},
	skillRuns: {
		id: "skill_runs.id",
		tenant_id: "skill_runs.tenant_id",
		invoker_user_id: "skill_runs.invoker_user_id",
		skill_id: "skill_runs.skill_id",
		resolved_inputs_hash: "skill_runs.resolved_inputs_hash",
		status: "skill_runs.status",
		finished_at: "skill_runs.finished_at",
		completion_hmac_secret: "skill_runs.completion_hmac_secret",
	},
	tenantSkills: {},
	tenantMcpServers: {},
	agentMcpServers: {},
	agentTemplateMcpServers: {},
	tenantBuiltinTools: {},
	connections: {},
	connectProviders: {},
	users: {
		id: "users.id",
		tenant_id: "users.tenant_id",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => ({ _and: a }),
	eq: (...a: unknown[]) => ({ _eq: a }),
	sql: (...a: unknown[]) => ({ _sql: a }),
	inArray: (...a: unknown[]) => ({ _inArray: a }),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
	InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: vi.fn(),
	GetObjectCommand: vi.fn(),
	PutObjectCommand: vi.fn(),
	DeleteObjectCommand: vi.fn(),
	ListObjectsV2Command: vi.fn(),
	CopyObjectCommand: vi.fn(),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn(),
	CreateSecretCommand: vi.fn(),
	UpdateSecretCommand: vi.fn(),
	DeleteSecretCommand: vi.fn(),
	GetSecretValueCommand: vi.fn(),
	ResourceNotFoundException: class {},
}));

import { handler } from "../handlers/skills.js";

const HMAC_SECRET = "test-secret-abc";

const sign = (runId: string, secret = HMAC_SECRET) =>
	`sha256=${createHmac("sha256", secret).update(runId).digest("hex")}`;

const BODY = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		runId: "R1",
		tenantId: "T1",
		status: "failed",
		failureReason: "step 'gather' failed: skill 'crm_account_summary' not registered",
		...overrides,
	});

const EVENT = (overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 => ({
	version: "2.0",
	routeKey: "POST /api/skills/complete",
	rawPath: "/api/skills/complete",
	rawQueryString: "",
	headers: {
		authorization: "Bearer api-secret",
		"x-skill-run-signature": sign("R1"),
	},
	requestContext: {
		http: { method: "POST", path: "/api/skills/complete", sourceIp: "", userAgent: "" },
	} as APIGatewayProxyEventV2["requestContext"],
	body: BODY(),
	isBase64Encoded: false,
	...overrides,
});

beforeEach(() => {
	vi.resetAllMocks();
	process.env.API_AUTH_SECRET = "api-secret";
	process.env.AGENTCORE_FUNCTION_NAME = "thinkwork-dev-api-agentcore-invoke";
	process.env.WORKSPACE_BUCKET = "test-bucket";
});

describe("POST /api/skills/complete — happy paths", () => {
	it("updates a running row to failed with a reason", async () => {
		mockSelect.mockReturnValueOnce([{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET }]);
		mockUpdateReturning.mockReturnValueOnce([
			{ id: "R1", status: "failed", finished_at: new Date("2026-04-22T13:00:00Z") },
		]);

		const res = await handler(EVENT());
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.runId).toBe("R1");
		expect(body.status).toBe("failed");
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it("updates a running row to complete with deliveredArtifactRef", async () => {
		mockSelect.mockReturnValueOnce([{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET }]);
		mockUpdateReturning.mockReturnValueOnce([
			{ id: "R1", status: "complete", finished_at: new Date() },
		]);

		const body = BODY({
			status: "complete",
			failureReason: null,
			deliveredArtifactRef: { kind: "chat", uri: "thread://..." },
		});
		const res = await handler(EVENT({ body }));
		expect(res.statusCode).toBe(200);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});
});

describe("POST /api/skills/complete — auth", () => {
	it("401s without bearer token", async () => {
		const res = await handler(EVENT({ headers: {} }));
		expect(res.statusCode).toBe(401);
	});

	it("401s with wrong bearer token", async () => {
		const res = await handler(EVENT({ headers: { authorization: "Bearer wrong" } }));
		expect(res.statusCode).toBe(401);
	});
});

describe("POST /api/skills/complete — validation", () => {
	it("400s when runId is missing", async () => {
		const res = await handler(EVENT({ body: BODY({ runId: undefined }) }));
		expect(res.statusCode).toBe(400);
		expect(res.body).toContain("Missing required fields");
	});

	it("400s when tenantId is missing", async () => {
		const res = await handler(EVENT({ body: BODY({ tenantId: undefined }) }));
		expect(res.statusCode).toBe(400);
	});

	it("400s when status is missing", async () => {
		const res = await handler(EVENT({ body: BODY({ status: undefined }) }));
		expect(res.statusCode).toBe(400);
	});

	it("400s for disallowed status", async () => {
		const res = await handler(EVENT({ body: BODY({ status: "running" }) }));
		expect(res.statusCode).toBe(400);
		expect(res.body).toContain("status must be one of");
	});

	it("400s when status is not complete and failureReason is missing", async () => {
		const res = await handler(EVENT({ body: BODY({ failureReason: undefined }) }));
		expect(res.statusCode).toBe(400);
		expect(res.body).toContain("failureReason is required");
	});

	it("400s on invalid JSON", async () => {
		const res = await handler(EVENT({ body: "{not-json" }));
		expect(res.statusCode).toBe(400);
	});
});

describe("POST /api/skills/complete — identity + transition checks", () => {
	it("404s when runId is not found", async () => {
		mockSelect.mockReturnValueOnce([]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(404);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("403s when tenantId does not match the row", async () => {
		mockSelect.mockReturnValueOnce([{ id: "R1", tenant_id: "T-other", status: "running", completion_hmac_secret: HMAC_SECRET }]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(403);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("400s when the row is already terminal", async () => {
		mockSelect.mockReturnValueOnce([{ id: "R1", tenant_id: "T1", status: "complete", completion_hmac_secret: HMAC_SECRET }]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(400);
		expect(res.body).toContain("invalid transition");
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});

describe("POST /api/skills/complete — per-run HMAC", () => {
	it("200s with a valid signature + burns the secret on success", async () => {
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET },
		]);
		mockUpdateReturning.mockReturnValueOnce([
			{ id: "R1", status: "failed", finished_at: new Date() },
		]);

		const res = await handler(EVENT());
		expect(res.statusCode).toBe(200);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it("401s when the signature header is missing", async () => {
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET },
		]);
		const res = await handler(EVENT({ headers: { authorization: "Bearer api-secret" } }));
		expect(res.statusCode).toBe(401);
		expect(res.body).toContain("invalid completion signature");
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("401s when the signature is computed from the wrong secret", async () => {
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET },
		]);
		const res = await handler(EVENT({
			headers: {
				authorization: "Bearer api-secret",
				"x-skill-run-signature": sign("R1", "attacker-secret"),
			},
		}));
		expect(res.statusCode).toBe(401);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("401s when the row's secret has been burned to NULL (already completed)", async () => {
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: null },
		]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(401);
		expect(res.body).toContain("run is no longer active");
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("401s when the signature is signed over a different runId", async () => {
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET },
		]);
		const res = await handler(EVENT({
			headers: {
				authorization: "Bearer api-secret",
				"x-skill-run-signature": sign("R-other", HMAC_SECRET),
			},
		}));
		expect(res.statusCode).toBe(401);
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});

describe("POST /api/skills/complete — TOCTOU race", () => {
	it("409s when the atomic CAS finds the row no longer in running state", async () => {
		// SELECT returns `running` (so auth + invariant checks pass), but the
		// atomic UPDATE returns zero rows — simulates a concurrent cancel
		// flipping status='cancelled' between SELECT and UPDATE. Must NOT
		// silently succeed or overwrite the terminal state.
		mockSelect.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", status: "running", completion_hmac_secret: HMAC_SECRET },
		]);
		mockUpdateReturning.mockReturnValueOnce([]);

		const res = await handler(EVENT());
		expect(res.statusCode).toBe(409);
		expect(res.body).toContain("run no longer in running state");
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});
});
