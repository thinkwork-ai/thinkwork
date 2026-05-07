/**
 * Integration: emitAuditEvent against the real dev `compliance.audit_outbox`.
 *
 * Runs only when DATABASE_URL is set (matches the existing `sandbox/`
 * + `user-memory-mcp/` harness convention). Each test wraps the helper
 * call + assertion in a transaction that deliberately ROLLS BACK so no
 * audit data persists in dev.
 *
 * Skipped in default CI; run via:
 *   DATABASE_URL=... pnpm --filter @thinkwork/api test test/integration/compliance-emit
 */

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auditOutbox } from "@thinkwork/database-pg/schema";
import { createDb } from "@thinkwork/database-pg";
import { emitAuditEvent } from "../../../src/lib/compliance";

// node-pg's TLS validator rejects RDS's default certificate chain on
// macOS / CI runners. Existing integration tests (sandbox/, user-memory-mcp/)
// flip sslmode=require → sslmode=no-verify for the same reason — the
// connection is still encrypted in transit; only CA verification is
// disabled.
function normalizeNodePgDatabaseUrl(
	url: string | undefined,
): string | undefined {
	return url?.replace("sslmode=require", "sslmode=no-verify");
}

const DATABASE_URL = normalizeNodePgDatabaseUrl(process.env.DATABASE_URL);
const skip = !DATABASE_URL;

describe.skipIf(skip)(
	"integration: emitAuditEvent → compliance.audit_outbox",
	() => {
		it("inserts a row inside a transaction; row is visible mid-tx and gone after rollback", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";

			let rowMidTx: typeof auditOutbox.$inferSelect | undefined;
			let emittedEventId: string | undefined;

			// Use a transaction that deliberately throws at the end so
			// Drizzle rolls back. The mid-tx SELECT happens before the
			// throw to verify the helper's INSERT was visible.
			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "22222222-2222-2222-2222-222222222222",
						actorType: "user",
						eventType: "agent.skills_changed",
						source: "graphql",
						payload: {
							agentId: "test-agent",
							skillIds: ["test-skill"],
						},
						controlIds: ["CC8.1"],
					});
					emittedEventId = result.eventId;

					// Mid-tx visibility check.
					const rows = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					rowMidTx = rows[0];

					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			// Assert mid-tx visibility.
			expect(rowMidTx).toBeDefined();
			expect(rowMidTx!.event_id).toBe(emittedEventId);
			expect(rowMidTx!.tenant_id).toBe(tenantId);
			expect(rowMidTx!.event_type).toBe("agent.skills_changed");
			expect(rowMidTx!.source).toBe("graphql");
			expect(rowMidTx!.payload).toEqual({
				agentId: "test-agent",
				skillIds: ["test-skill"],
			});
			expect(rowMidTx!.payload_redacted_fields).toEqual([]);
			expect(rowMidTx!.control_ids).toEqual(["CC8.1"]);

			// Assert post-rollback: row is GONE.
			const postRollback = await db
				.select()
				.from(auditOutbox)
				.where(eq(auditOutbox.event_id, emittedEventId!));
			expect(postRollback).toEqual([]);
		});

		it("control-evidence semantic: throwing in the same tx after a successful audit emit also rolls back the audit row", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";
			let emittedEventId: string | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "22222222-2222-2222-2222-222222222222",
						actorType: "user",
						eventType: "user.invited",
						source: "graphql",
						payload: {
							email: "test@example.com",
							role: "member",
							invitedBy: "u-admin",
						},
					});
					emittedEventId = result.eventId;

					// Caller's primary write fails here — rollback must
					// take the audit row with it (control-evidence "fail
					// closed" semantic per master plan R6).
					throw new Error("primary write failed");
				})
				.catch((e) => {
					if (e.message !== "primary write failed") throw e;
				});

			const rows = await db
				.select()
				.from(auditOutbox)
				.where(eq(auditOutbox.event_id, emittedEventId!));
			expect(rows).toEqual([]);
		});

		it("drainer-shape compatibility: row contains all columns the U4 drainer poll expects", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";
			let row: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "22222222-2222-2222-2222-222222222222",
						actorType: "user",
						eventType: "auth.signin.success",
						source: "graphql",
						payload: { userId: "u1", method: "password" },
					});
					const rows = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					row = rows[0];
					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(row).toBeDefined();
			// Drainer's FOR UPDATE SKIP LOCKED poll keys on these:
			expect(row!.outbox_id).toBeTruthy();
			expect(row!.event_id).toBeTruthy();
			expect(row!.tenant_id).toBeTruthy();
			expect(row!.enqueued_at).toBeInstanceOf(Date);
			expect(row!.drained_at).toBeNull();
			// Drainer copies these to compliance.audit_events:
			expect(row!.event_type).toBeTruthy();
			expect(row!.actor).toBeTruthy();
			expect(row!.actor_type).toBeTruthy();
			expect(row!.source).toBeTruthy();
			expect(row!.payload).toBeDefined();
			expect(Array.isArray(row!.control_ids)).toBe(true);
			expect(Array.isArray(row!.payload_redacted_fields)).toBe(true);
			expect(row!.payload_schema_version).toBe(1);
		});
	},
);
