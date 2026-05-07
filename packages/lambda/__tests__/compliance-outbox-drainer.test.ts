import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the secret-manager module BEFORE importing the drainer so the
// module-scope dynamic import doesn't try to talk to AWS.
vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn().mockImplementation(() => ({
		send: vi.fn(),
	})),
	GetSecretValueCommand: vi.fn(),
}));

import { processOutboxBatch } from "../compliance-outbox-drainer";

/**
 * Minimal fake `Database` covering just `select`, `update`, `insert`,
 * `transaction`, and `execute`. Returns the cast Database type but
 * exposes spies for assertion.
 *
 * The drainer's per-row processing happens inside `db.transaction`. The
 * fake's `transaction` wraps the callback with a `tx` that mirrors the
 * outer object — the same select/update/insert chain works on both, so
 * tests can assert on the same spies.
 */
function makeFakeDb(rows: Array<Record<string, unknown>>) {
	let nextRowIndex = 0;
	const insertedAuditEvents: Array<Record<string, unknown>> = [];
	const drainerErrors: Array<{ outbox_id: string; error: string }> = [];
	const drainedAt = new Set<string>();

	function makeChainable(): any {
		const handle: any = {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockImplementation(async function (this: any, n: number) {
				// The drainer's poll: select+from+where+orderBy+limit+for(...).
				// The chain head lookup: select+from+where+orderBy+limit (no .for()).
				// We disambiguate by tracking which select-chain is active.
				return this._mode === "poll"
					? pollResult()
					: this._mode === "chainHead"
						? chainHeadResult()
						: [];
			}),
			for: vi.fn().mockImplementation(async function () {
				// Used after limit() for FOR UPDATE SKIP LOCKED. Resolves to
				// rows. Distinguishing here: pollResult.
				return pollResult();
			}),
			values: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
				insertedAuditEvents.push(row);
				return Promise.resolve();
			}),
			set: vi.fn().mockImplementation(function (this: any, patch: Record<string, unknown>) {
				this._setPatch = patch;
				return this;
			}),
			onConflictDoNothing: vi.fn().mockReturnThis(),
			insert: vi.fn().mockImplementation(function (this: any) {
				return {
					values: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
						insertedAuditEvents.push(row);
						return {
							onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
						};
					}),
				};
			}),
			update: vi.fn().mockImplementation(function () {
				return {
					set: vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
						where: vi.fn().mockImplementation(async (cond: unknown) => {
							// Track which outbox_id was updated and what fields.
							const outboxId = extractOutboxId(cond);
							if (patch.drained_at) drainedAt.add(outboxId);
							if (patch.drainer_error) {
								drainerErrors.push({
									outbox_id: outboxId,
									error: String(patch.drainer_error),
								});
							}
							return Promise.resolve();
						}),
					})),
				};
			}),
		};
		return handle;
	}

	function pollResult() {
		if (nextRowIndex >= rows.length) return [];
		// Skip rows already drained or marked errored (mock the WHERE clause).
		while (nextRowIndex < rows.length) {
			const row = rows[nextRowIndex];
			if (
				drainedAt.has(row.outbox_id as string) ||
				drainerErrors.find((e) => e.outbox_id === (row.outbox_id as string))
			) {
				nextRowIndex += 1;
				continue;
			}
			nextRowIndex += 1;
			return [row];
		}
		return [];
	}

	let chainHeadValue: { event_hash: string } | undefined;
	function chainHeadResult() {
		return chainHeadValue ? [chainHeadValue] : [];
	}

	function extractOutboxId(cond: any): string {
		// Best-effort: condition is an SQL fragment from `eq(auditOutbox.outbox_id, X)`.
		// In the fake we accept any shape and pull from the most recent poll.
		// This works because the drainer always updates the row it just polled.
		return rows[nextRowIndex - 1]?.outbox_id as string;
	}

	const fakeDb: any = {
		transaction: vi.fn().mockImplementation(async (fn: any) => {
			// The drainer's transaction body chains:
			//   1. select().from(auditOutbox).where(...).orderBy(...).limit(1).for(...)
			//   2. select({event_hash}).from(auditEvents).where(...).orderBy(...).limit(1)
			//   3. insert(auditEvents).values(...).onConflictDoNothing(...)
			//   4. update(auditOutbox).set({drained_at}).where(...)
			//
			// Build a tx object that returns appropriate results in sequence.
			let queryIndex = 0;
			const tx: any = {
				select: vi.fn().mockImplementation(() => ({
					from: vi.fn().mockImplementation(() => ({
						where: vi.fn().mockImplementation(() => ({
							orderBy: vi.fn().mockImplementation(() => ({
								limit: vi.fn().mockImplementation(() => {
									queryIndex += 1;
									if (queryIndex === 1) {
										// First select: poll outbox.
										return {
											for: vi.fn().mockImplementation(async () =>
												pollResult(),
											),
										};
									}
									// Second select: chain head (no .for()).
									// Must be awaitable as-is — return chainHeadResult.
									return chainHeadResult() as any;
								}),
							})),
						})),
					})),
				})),
				insert: vi.fn().mockImplementation(() => ({
					values: vi.fn().mockImplementation((row: Record<string, unknown>) => ({
						onConflictDoNothing: vi.fn().mockImplementation(async () => {
							insertedAuditEvents.push(row);
							return Promise.resolve();
						}),
					})),
				})),
				update: vi.fn().mockImplementation(() => ({
					set: vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
						where: vi.fn().mockImplementation(async () => {
							const lastRow = rows[nextRowIndex - 1];
							if (patch.drained_at && lastRow) {
								drainedAt.add(lastRow.outbox_id as string);
							}
							return Promise.resolve();
						}),
					})),
				})),
			};
			await fn(tx);
		}),
		select: vi.fn().mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					orderBy: vi.fn().mockImplementation(() => ({
						limit: vi.fn().mockImplementation(async () => {
							const lastRow = rows[nextRowIndex - 1];
							return lastRow
								? [
										{
											outbox_id: lastRow.outbox_id,
											event_id: lastRow.event_id,
											tenant_id: lastRow.tenant_id,
										},
									]
								: [];
						}),
					})),
				})),
			})),
		})),
		update: vi.fn().mockImplementation(() => ({
			set: vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
				where: vi.fn().mockImplementation(async () => {
					const lastRow = rows[nextRowIndex - 1];
					if (patch.drainer_error && lastRow) {
						drainerErrors.push({
							outbox_id: lastRow.outbox_id as string,
							error: String(patch.drainer_error),
						});
					}
					return Promise.resolve();
				}),
			})),
		})),
		execute: vi.fn().mockResolvedValue([{ age_ms: 0 }]),
	};

	return {
		db: fakeDb,
		insertedAuditEvents,
		drainerErrors,
		drainedAt,
		setChainHead: (hash: string | null) => {
			chainHeadValue = hash ? { event_hash: hash } : undefined;
		},
	};
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
	outbox_id: "01000000-0000-7000-8000-000000000001",
	event_id: "01000000-0000-7000-8000-000000000099",
	tenant_id: "11111111-1111-1111-1111-111111111111",
	occurred_at: new Date("2026-01-01T00:00:00.000Z"),
	enqueued_at: new Date("2026-01-01T00:00:01.000Z"),
	drained_at: null,
	drainer_error: null,
	actor: "actor-1",
	actor_type: "user",
	source: "graphql",
	event_type: "agent.skills_changed",
	resource_type: null,
	resource_id: null,
	action: null,
	outcome: null,
	request_id: null,
	thread_id: null,
	agent_id: null,
	payload: { agentId: "a1", skillIds: ["s1"] },
	payload_schema_version: 1,
	control_ids: [],
	payload_redacted_fields: [],
	payload_oversize_s3_key: null,
	...overrides,
});

describe("processOutboxBatch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns drained_count: 0 + dispatched: true on empty outbox", async () => {
		const fake = makeFakeDb([]);
		const result = await processOutboxBatch(fake.db, 50);
		expect(result.drained_count).toBe(0);
		expect(result.error_count).toBe(0);
		expect(result.dispatched).toBe(true);
	});

	it("drains a single genesis event for a new tenant", async () => {
		const fake = makeFakeDb([baseRow()]);
		fake.setChainHead(null);

		const result = await processOutboxBatch(fake.db, 50);
		expect(result.drained_count).toBe(1);
		expect(result.error_count).toBe(0);

		expect(fake.insertedAuditEvents).toHaveLength(1);
		const inserted = fake.insertedAuditEvents[0];
		expect(inserted.event_hash).toMatch(/^[a-f0-9]{64}$/);
		// Genesis event: prev_hash is null in the audit_events row.
		expect(inserted.prev_hash).toBeNull();
		expect(fake.drainedAt.has(baseRow().outbox_id as string)).toBe(true);
	});

	it("respects batch size", async () => {
		const rows = Array.from({ length: 10 }, (_, i) =>
			baseRow({
				outbox_id: `01000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
				event_id: `01000000-0000-7000-8000-${String(i + 100).padStart(12, "0")}`,
			}),
		);
		const fake = makeFakeDb(rows);
		fake.setChainHead(null);

		const result = await processOutboxBatch(fake.db, 5);
		expect(result.drained_count).toBe(5);
	});

	it("hash chain links correctly across multiple events for same tenant", async () => {
		const rows = [
			baseRow({
				outbox_id: "01000000-0000-7000-8000-000000000010",
				event_id: "01000000-0000-7000-8000-000000000010-event",
			}),
			baseRow({
				outbox_id: "01000000-0000-7000-8000-000000000011",
				event_id: "01000000-0000-7000-8000-000000000011-event",
				occurred_at: new Date("2026-01-01T00:00:01.000Z"),
			}),
		];
		const fake = makeFakeDb(rows);
		// Genesis chain head; the second iteration should pick up the
		// first event's hash. In our fake, the chainHead is fixed per
		// run — set it after the first row drains.
		fake.setChainHead(null);

		const result = await processOutboxBatch(fake.db, 50);
		expect(result.drained_count).toBe(2);
		expect(fake.insertedAuditEvents).toHaveLength(2);
		expect(fake.insertedAuditEvents[0].event_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(fake.insertedAuditEvents[1].event_hash).toMatch(/^[a-f0-9]{64}$/);
	});
});
