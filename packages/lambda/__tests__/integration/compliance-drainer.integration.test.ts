/**
 * Integration: drainer end-to-end against dev compliance.audit_outbox
 * + audit_events.
 *
 * Inserts test rows directly into audit_outbox (bypasses
 * `emitAuditEvent` to avoid a packages/lambda → packages/api dep), then
 * exercises `processOutboxBatch` against dev. Assertions:
 *   - Rows land in audit_events with valid event_hash.
 *   - Per-tenant chain links correctly (prev_hash matches predecessor's
 *     event_hash; genesis is NULL).
 *   - Outbox rows marked drained_at.
 *   - Idempotency: second drain is a no-op.
 *
 * Skipped when DATABASE_URL is unset.
 */

import { describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "@thinkwork/database-pg";
import {
	auditEvents,
	auditOutbox,
} from "@thinkwork/database-pg/schema";
import { processOutboxBatch } from "../../compliance-outbox-drainer";

function normalizeNodePgDatabaseUrl(
	url: string | undefined,
): string | undefined {
	return url?.replace("sslmode=require", "sslmode=no-verify");
}

const DATABASE_URL = normalizeNodePgDatabaseUrl(process.env.DATABASE_URL);
const skip = !DATABASE_URL;

const TEST_TENANT = "99999999-9999-9999-9999-999999999999";

function uuidv7Like(seq: number): string {
	const ts = Date.now().toString(16).padStart(12, "0");
	const seqHex = seq.toString(16).padStart(4, "0");
	return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${seqHex.slice(0, 3)}-8${seqHex.slice(0, 3)}-${"0".repeat(12)}`;
}

describe.skipIf(skip)("integration: drainer end-to-end against dev", () => {
	it("drains 3 sequential outbox rows; chain links correctly", async () => {
		const db = createDb(DATABASE_URL!);

		// Insert 3 test rows directly into audit_outbox.
		const outboxIds: string[] = [];
		const eventIds: string[] = [];
		const now = Date.now();
		for (let i = 0; i < 3; i++) {
			const outboxId = uuidv7Like(now + i);
			const eventId = uuidv7Like(now + 100 + i);
			outboxIds.push(outboxId);
			eventIds.push(eventId);
			await db.insert(auditOutbox).values({
				outbox_id: outboxId,
				event_id: eventId,
				tenant_id: TEST_TENANT,
				occurred_at: new Date(now + i * 1000),
				actor: "22222222-2222-2222-2222-222222222222",
				actor_type: "user",
				source: "graphql",
				event_type: "agent.skills_changed",
				payload: { agentId: `a-${i}`, skillIds: [`s-${i}`] },
				control_ids: [],
				payload_redacted_fields: [],
			});
		}

		// Drain.
		const drainResult = await processOutboxBatch(db, 50);
		expect(drainResult.drained_count).toBeGreaterThanOrEqual(3);
		expect(drainResult.error_count).toBe(0);
		expect(drainResult.dispatched).toBe(true);

		// Each event_id landed in audit_events with a valid hash.
		const eventRows = await db
			.select()
			.from(auditEvents)
			.where(inArray(auditEvents.event_id, eventIds));
		expect(eventRows).toHaveLength(3);
		for (const row of eventRows) {
			expect(row.event_hash).toMatch(/^[a-f0-9]{64}$/);
		}

		// Sort by recorded_at to mirror the drainer's chain-head order.
		// Note: dev's TEST_TENANT chain accumulates rows across test runs
		// (audit_events is immutable), so the first row in this batch
		// chains to whatever the prior chain head was — NOT null. Genesis
		// behavior is unit-tested in hash-chain.test.ts; here we verify
		// intra-batch chain linkage only.
		eventRows.sort(
			(a, b) =>
				a.recorded_at.getTime() - b.recorded_at.getTime() ||
				a.event_id.localeCompare(b.event_id),
		);
		expect(eventRows[0].prev_hash).toMatch(/^[a-f0-9]{64}$|^$/); // 64-char hex OR null/empty for genesis
		for (let i = 1; i < eventRows.length; i++) {
			expect(eventRows[i].prev_hash).toBe(eventRows[i - 1].event_hash);
		}

		// Outbox rows marked drained.
		const outboxRows = await db
			.select()
			.from(auditOutbox)
			.where(inArray(auditOutbox.outbox_id, outboxIds));
		for (const row of outboxRows) {
			expect(row.drained_at).not.toBeNull();
		}
	}, 30_000);

	it("idempotency: second drain on already-drained outbox is a no-op", async () => {
		const db = createDb(DATABASE_URL!);

		const outboxId = uuidv7Like(Date.now() + 9999);
		const eventId = uuidv7Like(Date.now() + 10099);
		await db.insert(auditOutbox).values({
			outbox_id: outboxId,
			event_id: eventId,
			tenant_id: TEST_TENANT,
			occurred_at: new Date(),
			actor: "22222222-2222-2222-2222-222222222222",
			actor_type: "user",
			source: "graphql",
			event_type: "auth.signin.success",
			payload: { userId: "u1", method: "password", ip: "10.0.0.1" },
			control_ids: [],
			payload_redacted_fields: [],
		});

		const first = await processOutboxBatch(db, 50);
		expect(first.drained_count).toBeGreaterThanOrEqual(1);

		const second = await processOutboxBatch(db, 50);
		// Second invocation finds no new un-drained rows.
		expect(second.drained_count).toBe(0);
		expect(second.error_count).toBe(0);

		// Verify the row landed exactly once in audit_events (UNIQUE
		// constraint on outbox_id is the idempotency guarantee).
		const rows = await db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.event_id, eventId));
		expect(rows).toHaveLength(1);
	}, 30_000);

	it("returns drained_count: 0 + dispatched: true on empty outbox", async () => {
		const db = createDb(DATABASE_URL!);
		// Drain anything pending so the next call sees empty.
		await processOutboxBatch(db, 100);
		const result = await processOutboxBatch(db, 50);
		expect(result.drained_count).toBe(0);
		expect(result.error_count).toBe(0);
		expect(result.dispatched).toBe(true);
	}, 30_000);
});
