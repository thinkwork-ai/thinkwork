/**
 * Integration: end-to-end emitAuditEvent → outbox → drainer → audit_events.
 *
 * Exercises the full Phase 3 write path against dev Aurora. Calls the
 * U4 drainer's `processOutboxBatch` directly (in-process, not via the
 * deployed Lambda) so the test is hermetic and runs without AWS.
 *
 * Skipped when DATABASE_URL is unset; matches existing
 * compliance-emit/ harness convention.
 *
 * Cleanup: uses a sentinel tenant_id (`99999999-...`) so test rows are
 * easy to identify in dev. Audit_events rows are immutable per U1's
 * triggers, so they persist (this is by design — Phase 4 retention
 * sweep will handle cleanup of the test-tenant rows).
 */

import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import {
	auditEvents,
	auditOutbox,
} from "@thinkwork/database-pg/schema";
import { createDb } from "@thinkwork/database-pg";
import { emitAuditEvent } from "../../../src/lib/compliance";
import { processOutboxBatch } from "../../../../lambda/compliance-outbox-drainer";

function normalizeNodePgDatabaseUrl(
	url: string | undefined,
): string | undefined {
	return url?.replace("sslmode=require", "sslmode=no-verify");
}

const DATABASE_URL = normalizeNodePgDatabaseUrl(process.env.DATABASE_URL);
const skip = !DATABASE_URL;

const TEST_TENANT = "99999999-9999-9999-9999-999999999999";

describe.skipIf(skip)(
	"integration: emitAuditEvent → drainer → audit_events",
	() => {
		it("drains 3 sequential events for a tenant; chain links correctly", async () => {
			const db = createDb(DATABASE_URL!);

			// Emit 3 events for the test tenant in their own commits so
			// the outbox rows are visible to the drainer's poll.
			const emitted: Array<{ eventId: string; outboxId: string }> = [];
			for (let i = 0; i < 3; i++) {
				const result = await db.transaction(async (tx) => {
					return await emitAuditEvent(tx, {
						tenantId: TEST_TENANT,
						actorId: "22222222-2222-2222-2222-222222222222",
						actorType: "user",
						eventType: "agent.skills_changed",
						source: "graphql",
						payload: { agentId: `a-${i}`, skillIds: [`s-${i}`] },
					});
				});
				emitted.push({
					eventId: result.eventId,
					outboxId: result.outboxId,
				});
			}

			// Drain.
			const drainResult = await processOutboxBatch(db, 50);
			expect(drainResult.drained_count).toBeGreaterThanOrEqual(3);
			expect(drainResult.error_count).toBe(0);
			expect(drainResult.dispatched).toBe(true);

			// Verify each event landed in audit_events with a valid hash.
			for (const { eventId } of emitted) {
				const rows = await db
					.select()
					.from(auditEvents)
					.where(eq(auditEvents.event_id, eventId));
				expect(rows).toHaveLength(1);
				expect(rows[0].event_hash).toMatch(/^[a-f0-9]{64}$/);
			}

			// Verify the chain: each event's prev_hash matches its
			// predecessor's event_hash. Order by occurred_at ascending.
			const tenantRows = await db
				.select()
				.from(auditEvents)
				.where(eq(auditEvents.tenant_id, TEST_TENANT));

			tenantRows.sort(
				(a, b) =>
					a.occurred_at.getTime() - b.occurred_at.getTime() ||
					a.event_id.localeCompare(b.event_id),
			);

			for (let i = 1; i < tenantRows.length; i++) {
				expect(tenantRows[i].prev_hash).toBe(tenantRows[i - 1].event_hash);
			}
			// Genesis event has prev_hash NULL.
			expect(tenantRows[0].prev_hash).toBeNull();

			// Outbox rows for these events should be marked drained.
			for (const { outboxId } of emitted) {
				const rows = await db
					.select()
					.from(auditOutbox)
					.where(eq(auditOutbox.outbox_id, outboxId));
				expect(rows[0]?.drained_at).not.toBeNull();
			}
		}, 30_000);

		it("idempotency: running drainer twice on the same outbox state is a no-op the second time", async () => {
			const db = createDb(DATABASE_URL!);

			await db.transaction(async (tx) => {
				await emitAuditEvent(tx, {
					tenantId: TEST_TENANT,
					actorId: "22222222-2222-2222-2222-222222222222",
					actorType: "user",
					eventType: "auth.signin.success",
					source: "graphql",
					payload: { userId: "u1", method: "password", ip: "10.0.0.1" },
				});
			});

			const first = await processOutboxBatch(db, 50);
			expect(first.drained_count).toBeGreaterThanOrEqual(1);

			const second = await processOutboxBatch(db, 50);
			// Second run finds no un-drained rows for this tenant.
			expect(second.drained_count).toBe(0);
			expect(second.error_count).toBe(0);
		}, 30_000);

		it("returns drained_count: 0 + dispatched: true on empty outbox", async () => {
			const db = createDb(DATABASE_URL!);
			// First, drain anything pending so the next call sees an empty outbox.
			await processOutboxBatch(db, 100);
			const result = await processOutboxBatch(db, 50);
			expect(result.drained_count).toBe(0);
			expect(result.error_count).toBe(0);
			expect(result.dispatched).toBe(true);
		}, 30_000);
	},
);
