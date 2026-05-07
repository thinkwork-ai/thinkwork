import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// ─── Hoisted mocks (vi.mock factories are hoisted to top of the file,
//     so anything they reference must also be hoisted via vi.hoisted) ──

const {
	mockUsersSelect,
	mockOutboxSelect,
	mockTransaction,
	mockEmitAuditEvent,
	USERS_TABLE_SYMBOL,
	AUDIT_OUTBOX_TABLE_SYMBOL,
} = vi.hoisted(() => ({
	mockUsersSelect: vi.fn(),
	mockOutboxSelect: vi.fn(),
	mockTransaction: vi.fn(),
	mockEmitAuditEvent: vi.fn(),
	USERS_TABLE_SYMBOL: { __mock: "users" },
	AUDIT_OUTBOX_TABLE_SYMBOL: { __mock: "audit_outbox" },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	users: USERS_TABLE_SYMBOL,
	auditOutbox: AUDIT_OUTBOX_TABLE_SYMBOL,
}));

vi.mock("../lib/db.js", () => ({
	db: {
		select: vi.fn(() => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						if (table === USERS_TABLE_SYMBOL) {
							return Promise.resolve(mockUsersSelect());
						}
						if (table === AUDIT_OUTBOX_TABLE_SYMBOL) {
							return Promise.resolve(mockOutboxSelect());
						}
						return Promise.resolve([]);
					},
				}),
			}),
		})),
		transaction: mockTransaction,
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}));

vi.mock("../lib/compliance/emit.js", () => ({
	emitAuditEvent: mockEmitAuditEvent,
}));

// ─── Import handler AFTER mocks ───────────────────────────────────────

import { handler } from "./compliance.js";

// ─── Fixtures ─────────────────────────────────────────────────────────

const VALID_EVENT_ID = "01900000-0000-7000-8000-000000000001";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "33333333-3333-3333-3333-333333333333";
const SECRET = "test-api-secret";

function buildEvent(
	overrides: Partial<{
		body: Record<string, unknown> | string | null;
		bearer: string | null;
		method: string;
		path: string;
		idempotencyKey: string | null;
	}> = {},
): APIGatewayProxyEventV2 {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (overrides.bearer !== null) {
		headers.authorization = `Bearer ${overrides.bearer ?? SECRET}`;
	}
	if (overrides.idempotencyKey !== null && overrides.idempotencyKey) {
		headers["idempotency-key"] = overrides.idempotencyKey;
	}
	return {
		version: "2.0",
		routeKey: "POST /api/compliance/events",
		rawPath: overrides.path ?? "/api/compliance/events",
		rawQueryString: "",
		headers,
		requestContext: {
			http: {
				method: overrides.method ?? "POST",
				path: overrides.path ?? "/api/compliance/events",
				protocol: "HTTP/1.1",
				sourceIp: "127.0.0.1",
				userAgent: "test",
			},
		} as never,
		body:
			typeof overrides.body === "string"
				? overrides.body
				: overrides.body === null
					? undefined
					: JSON.stringify(
							overrides.body ?? {
								event_id: VALID_EVENT_ID,
								tenantId: TENANT_A,
								actorUserId: USER_A,
								actorType: "user",
								eventType: "agent.skills_changed",
								source: "strands",
								payload: {
									agentId: "test-agent",
									addedSkills: ["test"],
									removedSkills: [],
									reason: "test",
								},
							},
						),
		isBase64Encoded: false,
	};
}

function bodyJson(
	result: APIGatewayProxyStructuredResultV2,
): Record<string, unknown> {
	return JSON.parse(typeof result.body === "string" ? result.body : "{}");
}

describe("compliance.events handler", () => {
	beforeEach(() => {
		mockUsersSelect.mockReset();
		mockOutboxSelect.mockReset();
		mockTransaction.mockReset();
		mockEmitAuditEvent.mockReset();
		process.env.API_AUTH_SECRET = SECRET;
		// Default: actor exists in tenant A; outbox is empty (idempotency miss).
		mockUsersSelect.mockReturnValue([{ tenant_id: TENANT_A }]);
		mockOutboxSelect.mockReturnValue([]);
		mockTransaction.mockImplementation(
			async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
		);
		mockEmitAuditEvent.mockResolvedValue({
			eventId: VALID_EVENT_ID,
			outboxId: "outbox-id-1",
			redactedFields: [],
		});
	});

	describe("happy path", () => {
		it("emits audit event and returns dispatched: true", async () => {
			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(200);
			const body = bodyJson(result);
			expect(body).toMatchObject({
				dispatched: true,
				idempotent: false,
				eventId: VALID_EVENT_ID,
				outboxId: "outbox-id-1",
				redactedFields: [],
			});
			expect(mockEmitAuditEvent).toHaveBeenCalledOnce();
		});

		it("passes optional envelope fields through to the helper", async () => {
			await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: USER_A,
						actorType: "user",
						eventType: "agent.skills_changed",
						source: "strands",
						payload: { agentId: "a", addedSkills: ["x"] },
						occurredAt: "2026-05-07T12:00:00Z",
						resourceType: "agent",
						resourceId: "agent-id",
						action: "update",
						outcome: "success",
						requestId: "req-1",
						threadId: "thread-1",
						agentId: "agent-1",
						controlIds: ["CC8.1"],
					},
				}),
			);

			const callArg = mockEmitAuditEvent.mock.calls[0][1];
			expect(callArg).toMatchObject({
				eventId: VALID_EVENT_ID,
				tenantId: TENANT_A,
				actorId: USER_A,
				resourceType: "agent",
				resourceId: "agent-id",
				action: "update",
				outcome: "success",
				requestId: "req-1",
				threadId: "thread-1",
				agentId: "agent-1",
				controlIds: ["CC8.1"],
			});
			expect(callArg.occurredAt).toBeInstanceOf(Date);
		});
	});

	describe("idempotency", () => {
		it("returns idempotent: true on replay (existing outbox row)", async () => {
			mockOutboxSelect.mockReturnValue([
				{ event_id: VALID_EVENT_ID, outbox_id: "existing-outbox-id" },
			]);

			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(200);
			const body = bodyJson(result);
			expect(body).toMatchObject({
				dispatched: true,
				idempotent: true,
				eventId: VALID_EVENT_ID,
				outboxId: "existing-outbox-id",
			});
			// emit helper NEVER called on replay
			expect(mockEmitAuditEvent).not.toHaveBeenCalled();
		});

		it("recovers from 23505 race by re-running SELECT and returning idempotent: true", async () => {
			// First SELECT (idempotency pre-check): empty.
			// emit throws 23505.
			// Second SELECT (post-23505 re-check): returns the raced row.
			mockOutboxSelect
				.mockReturnValueOnce([])
				.mockReturnValueOnce([
					{ event_id: VALID_EVENT_ID, outbox_id: "raced-outbox-id" },
				]);
			const pgError = Object.assign(new Error("duplicate key"), {
				code: "23505",
			});
			mockEmitAuditEvent.mockRejectedValueOnce(pgError);

			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(200);
			expect(bodyJson(result)).toMatchObject({
				dispatched: true,
				idempotent: true,
				eventId: VALID_EVENT_ID,
				outboxId: "raced-outbox-id",
			});
		});

		it("recovers from 23505 race when pg code is on err.cause (drizzle-wrapped)", async () => {
			// drizzle-orm wraps the underlying pg error so .code lives
			// on err.cause, not err itself. The handler must check both.
			mockOutboxSelect
				.mockReturnValueOnce([])
				.mockReturnValueOnce([
					{ event_id: VALID_EVENT_ID, outbox_id: "raced-outbox-id" },
				]);
			const pgError = Object.assign(new Error("drizzle insert failed"), {
				cause: { code: "23505" },
			});
			mockEmitAuditEvent.mockRejectedValueOnce(pgError);

			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(200);
			expect(bodyJson(result)).toMatchObject({
				dispatched: true,
				idempotent: true,
				outboxId: "raced-outbox-id",
			});
		});

		it("accepts Idempotency-Key header that mirrors body event_id", async () => {
			const result = await handler(
				buildEvent({ idempotencyKey: VALID_EVENT_ID }),
			);
			expect(result.statusCode).toBe(200);
		});

		it("rejects 400 when Idempotency-Key header disagrees with body event_id", async () => {
			const result = await handler(
				buildEvent({
					idempotencyKey: "01900000-0000-7000-8000-000000000999",
				}),
			);
			expect(result.statusCode).toBe(400);
			expect(bodyJson(result)).toMatchObject({
				error: expect.stringContaining("Idempotency-Key"),
			});
		});
	});

	describe("auth", () => {
		it("rejects missing bearer with 401", async () => {
			const result = await handler(buildEvent({ bearer: null }));
			expect(result.statusCode).toBe(401);
			expect(mockEmitAuditEvent).not.toHaveBeenCalled();
		});

		it("rejects wrong bearer with 401", async () => {
			const result = await handler(buildEvent({ bearer: "wrong-secret" }));
			expect(result.statusCode).toBe(401);
			expect(mockEmitAuditEvent).not.toHaveBeenCalled();
		});
	});

	describe("cross-tenant guard", () => {
		it("returns 403 when actorUserId belongs to a different tenant", async () => {
			mockUsersSelect.mockReturnValue([{ tenant_id: TENANT_B }]);

			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(403);
			expect(mockEmitAuditEvent).not.toHaveBeenCalled();
		});

		it("returns 403 when actorUserId does not exist (does not reveal nonexistence)", async () => {
			mockUsersSelect.mockReturnValue([]);

			const result = await handler(buildEvent());

			expect(result.statusCode).toBe(403);
			expect(mockEmitAuditEvent).not.toHaveBeenCalled();
		});

		it("skips users-table SELECT for actorType: 'system' (platform-credential actorIds)", async () => {
			// system / agent actorTypes pass non-users.id values (e.g.
			// "platform-credential"). The cross-tenant guard would
			// always 403 them if it SELECTed users; the handler must
			// only run the SELECT for actorType: "user".
			mockUsersSelect.mockReturnValue([]);
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: "platform-credential",
						actorType: "system",
						eventType: "agent.skills_changed",
						source: "strands",
						payload: { agentId: "a" },
					},
				}),
			);

			expect(result.statusCode).toBe(200);
			expect(mockEmitAuditEvent).toHaveBeenCalledOnce();
		});

		it("skips users-table SELECT for actorType: 'agent'", async () => {
			mockUsersSelect.mockReturnValue([]);
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: "agent-id-uuid",
						actorType: "agent",
						eventType: "agent.skills_changed",
						source: "strands",
						payload: { agentId: "a" },
					},
				}),
			);

			expect(result.statusCode).toBe(200);
			expect(mockEmitAuditEvent).toHaveBeenCalledOnce();
		});
	});

	describe("body validation", () => {
		it("rejects missing event_id with 400", async () => {
			const result = await handler(
				buildEvent({
					body: {
						tenantId: TENANT_A,
						actorUserId: USER_A,
						eventType: "x",
						payload: {},
					},
				}),
			);
			expect(result.statusCode).toBe(400);
			expect(bodyJson(result).error).toContain("event_id");
		});

		it("rejects malformed event_id (uuid4 disallowed) with 400", async () => {
			const result = await handler(
				buildEvent({
					body: {
						event_id: "01900000-0000-4000-8000-000000000001",
						tenantId: TENANT_A,
						actorUserId: USER_A,
						eventType: "x",
						payload: {},
					},
				}),
			);
			expect(result.statusCode).toBe(400);
		});

		it("rejects missing tenantId with 400", async () => {
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						actorUserId: USER_A,
						eventType: "x",
						payload: {},
					},
				}),
			);
			expect(result.statusCode).toBe(400);
		});

		it("rejects missing payload with 400", async () => {
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: USER_A,
						eventType: "x",
					},
				}),
			);
			expect(result.statusCode).toBe(400);
		});

		it("rejects unknown actorType with 400", async () => {
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: USER_A,
						actorType: "alien",
						eventType: "x",
						payload: {},
					},
				}),
			);
			expect(result.statusCode).toBe(400);
		});

		it("maps emitAuditEvent validation errors to 400", async () => {
			mockEmitAuditEvent.mockRejectedValue(
				new Error('emitAuditEvent: unknown eventType "made-up.event"'),
			);
			const result = await handler(
				buildEvent({
					body: {
						event_id: VALID_EVENT_ID,
						tenantId: TENANT_A,
						actorUserId: USER_A,
						eventType: "made-up.event",
						payload: {},
					},
				}),
			);
			expect(result.statusCode).toBe(400);
			expect(bodyJson(result).error).toContain("unknown eventType");
		});

		it("rejects malformed JSON with 400", async () => {
			const result = await handler(buildEvent({ body: "not-json" }));
			expect(result.statusCode).toBe(400);
		});
	});

	describe("method + path matching", () => {
		it("rejects wrong method with 405", async () => {
			const result = await handler(buildEvent({ method: "GET" }));
			expect(result.statusCode).toBe(405);
		});

		it("rejects wrong path with 404", async () => {
			const result = await handler(buildEvent({ path: "/api/other" }));
			expect(result.statusCode).toBe(404);
		});
	});
});
