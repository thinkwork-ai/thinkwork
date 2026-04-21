/**
 * Tests for POST /api/skills/start — service-to-service startSkillRun wrapper.
 *
 * Covered:
 *   * happy path: inserts row → invokes agentcore-invoke → returns {runId, status}
 *   * dedup hit: INSERT returns 0 rows → surfaces existing run with deduped=true
 *   * unauth: no token / wrong token → 401
 *   * input validation: missing required fields / invalid invocation_source → 400
 *   * cross-tenant invoker → 403
 *   * unknown invoker → 404
 *   * invoke failure → row → failed + 502
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
	mockSelect,
	mockInsert,
	mockUpdate,
	mockLambdaSend,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockInsert: vi.fn(),
	mockUpdate: vi.fn(),
	mockLambdaSend: vi.fn(),
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

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		select: () => selectChain((mockSelect() as Rows) ?? []),
		insert: () => insertChain((mockInsert() as Rows) ?? []),
		update: () => {
			mockUpdate();
			return updateChain();
		},
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
	LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
	InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

// The handler also pulls in S3 / SecretsManager / signed urls but we don't
// exercise those code paths — lightweight stubs keep imports happy.
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

const BODY = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		tenantId: "T1",
		invokerUserId: "U1",
		agentId: "A1",
		skillId: "sales-prep",
		skillVersion: 1,
		invocationSource: "chat",
		inputs: { customer: "cust-abc" },
		...overrides,
	});

const EVENT = (overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 => ({
	version: "2.0",
	routeKey: "POST /api/skills/start",
	rawPath: "/api/skills/start",
	rawQueryString: "",
	headers: { authorization: "Bearer api-secret" },
	requestContext: {
		http: { method: "POST", path: "/api/skills/start", sourceIp: "", userAgent: "" },
	} as APIGatewayProxyEventV2["requestContext"],
	body: BODY(),
	isBase64Encoded: false,
	...overrides,
});

beforeEach(() => {
	// resetAllMocks (not clearAllMocks) drains the mockReturnValueOnce queue
	// between tests so a test that queued values but didn't consume them all
	// doesn't leak into the next.
	vi.resetAllMocks();
	process.env.API_AUTH_SECRET = "api-secret";
	process.env.AGENTCORE_FUNCTION_NAME = "thinkwork-dev-api-agentcore-invoke";
	process.env.WORKSPACE_BUCKET = "test-bucket";
	mockLambdaSend.mockResolvedValue({ FunctionError: undefined });
});

describe("POST /api/skills/start — happy path", () => {
	it("inserts row and invokes AgentCore", async () => {
		mockSelect.mockReturnValueOnce([{ id: "U1", tenant_id: "T1" }]); // invoker lookup
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);

		const res = await handler(EVENT());

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.runId).toBe("run-1");
		expect(body.status).toBe("running");
		expect(body.deduped).toBe(false);
		expect(mockLambdaSend).toHaveBeenCalledTimes(1);
	});
});

describe("POST /api/skills/start — dedup", () => {
	it("returns existing run with deduped=true when INSERT yields zero rows", async () => {
		mockSelect.mockReturnValueOnce([{ id: "U1", tenant_id: "T1" }]);
		mockInsert.mockReturnValueOnce([]); // dedup hit
		mockSelect.mockReturnValueOnce([{ id: "run-existing", status: "running" }]);

		const res = await handler(EVENT());

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.runId).toBe("run-existing");
		expect(body.deduped).toBe(true);
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});

describe("POST /api/skills/start — auth", () => {
	it("401s without bearer token", async () => {
		const event = EVENT({ headers: {} });
		const res = await handler(event);
		expect(res.statusCode).toBe(401);
	});

	it("401s with wrong bearer token", async () => {
		const event = EVENT({ headers: { authorization: "Bearer wrong" } });
		const res = await handler(event);
		expect(res.statusCode).toBe(401);
	});
});

describe("POST /api/skills/start — validation", () => {
	it("400s on missing skillId", async () => {
		mockSelect.mockReturnValueOnce([{ id: "U1", tenant_id: "T1" }]);
		const res = await handler(EVENT({ body: BODY({ skillId: undefined }) }));
		expect(res.statusCode).toBe(400);
		expect((res.body as string).toLowerCase()).toContain("required");
	});

	it("400s on unknown invocationSource", async () => {
		const res = await handler(EVENT({ body: BODY({ invocationSource: "chatroom" }) }));
		expect(res.statusCode).toBe(400);
		expect(res.body as string).toContain("invocationSource");
	});

	it("400s on malformed JSON body", async () => {
		const res = await handler(EVENT({ body: "{not json" }));
		expect(res.statusCode).toBe(400);
	});
});

describe("POST /api/skills/start — identity checks", () => {
	it("404s when invoker does not exist", async () => {
		mockSelect.mockReturnValueOnce([]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(404);
	});

	it("403s on cross-tenant invoker", async () => {
		mockSelect.mockReturnValueOnce([{ id: "U1", tenant_id: "OTHER" }]);
		const res = await handler(EVENT());
		expect(res.statusCode).toBe(403);
		expect(res.body as string).toContain("tenant");
	});
});

describe("POST /api/skills/start — invoke failure", () => {
	it("transitions row to failed and returns 502 when AgentCore throws", async () => {
		mockSelect.mockReturnValueOnce([{ id: "U1", tenant_id: "T1" }]);
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);
		mockLambdaSend.mockResolvedValueOnce({
			FunctionError: "Unhandled",
			Payload: new TextEncoder().encode("boom"),
		});

		const res = await handler(EVENT());

		expect(res.statusCode).toBe(502);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});
});
