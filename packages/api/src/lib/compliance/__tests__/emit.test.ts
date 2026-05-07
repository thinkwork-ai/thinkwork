import { describe, expect, it, vi } from "vitest";
import { auditOutbox } from "@thinkwork/database-pg/schema";
import { emitAuditEvent } from "../emit";

/**
 * Mock Drizzle insert chain. Returns the row passed to `.values()` so
 * tests can assert envelope shape.
 *
 * The cast to `Parameters<typeof emitAuditEvent>[0]` is intentional —
 * the helper's typed parameter is the full Drizzle Database/PgTransaction
 * surface, but tests only exercise `.insert(...).values(...)` so a
 * minimal mock is enough at runtime.
 */
function makeMockTx() {
	const valuesSpy = vi.fn().mockResolvedValue(undefined);
	const insertSpy = vi.fn().mockReturnValue({ values: valuesSpy });
	return {
		tx: { insert: insertSpy } as unknown as Parameters<
			typeof emitAuditEvent
		>[0],
		insertSpy,
		valuesSpy,
	};
}

const validInput = {
	tenantId: "11111111-1111-1111-1111-111111111111",
	actorId: "22222222-2222-2222-2222-222222222222",
	actorType: "user" as const,
	eventType: "agent.skills_changed" as const,
	source: "graphql" as const,
	payload: { agentId: "a1", skillIds: ["s1"] },
};

describe("emitAuditEvent", () => {
	describe("happy path", () => {
		it("inserts a redacted row into audit_outbox and returns identifiers", async () => {
			const { tx, insertSpy, valuesSpy } = makeMockTx();

			const result = await emitAuditEvent(tx, validInput);

			expect(insertSpy).toHaveBeenCalledWith(auditOutbox);
			expect(valuesSpy).toHaveBeenCalledTimes(1);

			const row = valuesSpy.mock.calls[0][0];
			expect(row).toMatchObject({
				tenant_id: validInput.tenantId,
				actor: validInput.actorId,
				actor_type: "user",
				event_type: "agent.skills_changed",
				source: "graphql",
				payload: { agentId: "a1", skillIds: ["s1"] },
				payload_redacted_fields: [],
				control_ids: [],
				payload_schema_version: 1,
			});
			expect(row.event_id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
			);
			expect(row.outbox_id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
			);
			expect(row.occurred_at).toBeInstanceOf(Date);

			expect(result.eventId).toBe(row.event_id);
			expect(result.outboxId).toBe(row.outbox_id);
			expect(result.redactedFields).toEqual([]);
		});

		it("returns redactedFields when allow-list drops fields", async () => {
			const { tx, valuesSpy } = makeMockTx();

			const result = await emitAuditEvent(tx, {
				...validInput,
				payload: { agentId: "a1", skillIds: ["s1"], apiKey: "sk-bad" },
			});

			expect(result.redactedFields).toContain("apiKey");
			const row = valuesSpy.mock.calls[0][0];
			expect(row.payload).not.toHaveProperty("apiKey");
		});

		it("uses the caller's occurredAt when provided", async () => {
			const { tx, valuesSpy } = makeMockTx();
			const fixedDate = new Date("2026-01-01T00:00:00Z");

			await emitAuditEvent(tx, { ...validInput, occurredAt: fixedDate });

			expect(valuesSpy.mock.calls[0][0].occurred_at).toBe(fixedDate);
		});

		it("defaults occurredAt to now() when omitted", async () => {
			const { tx, valuesSpy } = makeMockTx();
			const before = new Date();

			await emitAuditEvent(tx, validInput);

			const row = valuesSpy.mock.calls[0][0];
			const after = new Date();
			expect(row.occurred_at.getTime()).toBeGreaterThanOrEqual(
				before.getTime(),
			);
			expect(row.occurred_at.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		it("passes through optional envelope fields", async () => {
			const { tx, valuesSpy } = makeMockTx();

			await emitAuditEvent(tx, {
				...validInput,
				resourceType: "agent",
				resourceId: "a-1",
				action: "update",
				outcome: "success",
				requestId: "req-1",
				threadId: "33333333-3333-3333-3333-333333333333",
				agentId: "a-1",
				controlIds: ["CC8.1"],
			});

			const row = valuesSpy.mock.calls[0][0];
			expect(row.resource_type).toBe("agent");
			expect(row.resource_id).toBe("a-1");
			expect(row.action).toBe("update");
			expect(row.outcome).toBe("success");
			expect(row.request_id).toBe("req-1");
			expect(row.thread_id).toBe("33333333-3333-3333-3333-333333333333");
			expect(row.agent_id).toBe("a-1");
			expect(row.control_ids).toEqual(["CC8.1"]);
		});
	});

	describe("UUIDv7 monotonicity", () => {
		it("generates time-ordered event_ids in tight loop", async () => {
			const { tx } = makeMockTx();
			const ids: string[] = [];

			for (let i = 0; i < 50; i++) {
				const result = await emitAuditEvent(tx, validInput);
				ids.push(result.eventId);
			}

			// UUIDv7's leading 48 bits are a Unix timestamp (ms); within the
			// same millisecond, the library's monotonic counter ensures
			// strictly-ascending lexicographic order.
			const sorted = [...ids].sort();
			expect(ids).toEqual(sorted);
		});
	});

	describe("validation errors (no insert)", () => {
		it("throws on missing tenantId", async () => {
			const { tx, insertSpy } = makeMockTx();
			await expect(
				emitAuditEvent(tx, { ...validInput, tenantId: "" }),
			).rejects.toThrow(/tenantId is required/);
			expect(insertSpy).not.toHaveBeenCalled();
		});

		it("throws on missing actorId", async () => {
			const { tx, insertSpy } = makeMockTx();
			await expect(
				emitAuditEvent(tx, { ...validInput, actorId: "" }),
			).rejects.toThrow(/actorId is required/);
			expect(insertSpy).not.toHaveBeenCalled();
		});

		it("throws on unknown eventType", async () => {
			const { tx, insertSpy } = makeMockTx();
			await expect(
				emitAuditEvent(tx, {
					...validInput,
					eventType: "fake.event" as never,
				}),
			).rejects.toThrow(/unknown eventType/);
			expect(insertSpy).not.toHaveBeenCalled();
		});

		it("throws on unknown actorType", async () => {
			const { tx, insertSpy } = makeMockTx();
			await expect(
				emitAuditEvent(tx, {
					...validInput,
					actorType: "robot" as never,
				}),
			).rejects.toThrow(/unknown actorType/);
			expect(insertSpy).not.toHaveBeenCalled();
		});

		it("throws on unknown source", async () => {
			const { tx, insertSpy } = makeMockTx();
			await expect(
				emitAuditEvent(tx, { ...validInput, source: "smoke" as never }),
			).rejects.toThrow(/unknown source/);
			expect(insertSpy).not.toHaveBeenCalled();
		});
	});

	describe("propagation of insert failure", () => {
		it("re-throws the underlying error from tx.insert", async () => {
			const insertError = new Error("simulated DB failure");
			const tx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockRejectedValue(insertError),
				}),
			} as unknown as Parameters<typeof emitAuditEvent>[0];

			await expect(emitAuditEvent(tx, validInput)).rejects.toBe(insertError);
		});
	});

	describe("Phase 6 reserved event types (R14)", () => {
		it("policy.evaluated is accepted; payload fields all dropped (empty allow-list)", async () => {
			const { tx, valuesSpy } = makeMockTx();

			const result = await emitAuditEvent(tx, {
				...validInput,
				eventType: "policy.evaluated",
				payload: { policyId: "p1", outcome: "allow" },
			});

			expect(result.redactedFields.sort()).toEqual(["outcome", "policyId"]);
			expect(valuesSpy.mock.calls[0][0].payload).toEqual({});
		});
	});
});
