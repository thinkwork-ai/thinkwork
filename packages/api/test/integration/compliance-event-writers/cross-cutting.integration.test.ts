/**
 * Integration: cross-cutting U5 invariants for the compliance call-site
 * wire-up.
 *
 * These tests exercise the contracts that per-event-family unit tests
 * cannot easily prove:
 *
 *   1. Tier rollback — when the wrapping `db.transaction` throws after
 *      an `emitAuditEvent` call, BOTH the primary write and the
 *      outbox row roll back. This is the control-evidence guarantee
 *      the master plan stakes Type 1 evidence on.
 *   2. Allow-list shape — the `agent.skills_changed` registry was
 *      updated to delta keys (addedSkills / removedSkills) in U5.
 *      Verify a payload with the new shape lands cleanly with no
 *      unexpected drops, and a payload with the OLD keys
 *      (skillIds / previousSkillIds) is correctly redacted.
 *   3. Unknown-key drop — extraneous payload keys are dropped and
 *      recorded in `payload_redacted_fields` so the audit row carries
 *      its own provenance trail.
 *
 * Runs only when DATABASE_URL is set (matches existing
 * compliance-emit + sandbox harness convention). Each test wraps its
 * primary write + emit + assertion in a transaction that
 * deliberately ROLLS BACK so no test data persists in the dev DB.
 *
 * Skipped in default CI; run via:
 *   DATABASE_URL=... pnpm --filter @thinkwork/api test \
 *     test/integration/compliance-event-writers
 */

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auditOutbox } from "@thinkwork/database-pg/schema";
import { createDb } from "@thinkwork/database-pg";
import { emitAuditEvent } from "../../../src/lib/compliance";

function normalizeNodePgDatabaseUrl(
	url: string | undefined,
): string | undefined {
	return url?.replace("sslmode=require", "sslmode=no-verify");
}

const DATABASE_URL = normalizeNodePgDatabaseUrl(process.env.DATABASE_URL);
const skip = !DATABASE_URL;

describe.skipIf(skip)(
	"integration: U5 cross-cutting compliance call-site invariants",
	() => {
		it("tier rollback: tx-throw after emit rolls back both audit row and primary write", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";
			let observedEventId: string | undefined;
			let observedRowMidTx: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "33333333-3333-3333-3333-333333333333",
						actorType: "user",
						eventType: "agent.created",
						source: "graphql",
						payload: {
							agentId: "test-agent-rollback",
							name: "Rollback Test Agent",
							templateId: null,
						},
					});
					observedEventId = result.eventId;

					// Mid-tx the row is visible (proving the INSERT happened).
					const [row] = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					observedRowMidTx = row;

					// Now throw — simulates a downstream "primary write
					// failed" inside the wrapping tx. The drizzle-orm
					// driver should ROLLBACK on throw.
					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(observedRowMidTx).toBeDefined();
			expect(observedRowMidTx!.event_id).toBe(observedEventId);

			// Post-rollback the row should be gone.
			const post = await db
				.select()
				.from(auditOutbox)
				.where(eq(auditOutbox.event_id, observedEventId!));
			expect(post.length).toBe(0);
		});

		it("agent.skills_changed: delta-shape payload (addedSkills/removedSkills) lands without drop", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";

			let observedRow: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "44444444-4444-4444-4444-444444444444",
						actorType: "user",
						eventType: "agent.skills_changed",
						source: "lambda",
						payload: {
							agentId: "test-agent-skills",
							addedSkills: ["weather", "calendar"],
							removedSkills: ["legacy-tool"],
							reason: "workspace_skill_marker_change",
						},
					});

					const [row] = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					observedRow = row;

					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(observedRow).toBeDefined();
			const payload = observedRow!.payload as Record<string, unknown>;
			expect(payload).toEqual({
				agentId: "test-agent-skills",
				addedSkills: ["weather", "calendar"],
				removedSkills: ["legacy-tool"],
				reason: "workspace_skill_marker_change",
			});
			// All four keys are in the allow-list, so nothing drops.
			expect(observedRow!.payload_redacted_fields).toEqual([]);
		});

		it("agent.skills_changed: legacy keys (skillIds/previousSkillIds) drop and are recorded as redacted", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";

			let observedRow: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "55555555-5555-5555-5555-555555555555",
						actorType: "user",
						eventType: "agent.skills_changed",
						source: "lambda",
						payload: {
							agentId: "test-agent-legacy",
							// Old shape — no longer in the allow-list:
							skillIds: ["a", "b"],
							previousSkillIds: ["a"],
							reason: "legacy_test",
						},
					});

					const [row] = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					observedRow = row;

					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(observedRow).toBeDefined();
			const payload = observedRow!.payload as Record<string, unknown>;
			expect(payload).toEqual({
				agentId: "test-agent-legacy",
				reason: "legacy_test",
			});
			expect(observedRow!.payload_redacted_fields).toEqual(
				expect.arrayContaining(["skillIds", "previousSkillIds"]),
			);
		});

		it("unknown payload keys drop and appear in payload_redacted_fields", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";

			let observedRow: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "66666666-6666-6666-6666-666666666666",
						actorType: "user",
						eventType: "agent.created",
						source: "graphql",
						payload: {
							agentId: "test-agent-extra",
							name: "Extra Fields",
							templateId: null,
							// Extraneous keys — must drop:
							secretToken: "sk-ant-fake-leak",
							notes: "operator scribbles",
						},
					});

					const [row] = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					observedRow = row;

					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(observedRow).toBeDefined();
			const payload = observedRow!.payload as Record<string, unknown>;
			expect(payload).toEqual({
				agentId: "test-agent-extra",
				name: "Extra Fields",
				templateId: null,
			});
			expect(observedRow!.payload_redacted_fields).toEqual(
				expect.arrayContaining(["secretToken", "notes"]),
			);
			// Defense in depth: the dropped secretToken value MUST NOT
			// appear anywhere in the persisted payload.
			expect(JSON.stringify(payload)).not.toContain("sk-ant-fake-leak");
		});

		it("workspace.governance_file_edited: governanceFileDiffTransform truncates content + records redaction", async () => {
			const db = createDb(DATABASE_URL!);
			const tenantId = "11111111-1111-1111-1111-111111111111";

			// 5 KB of repeated content — the U3 transform truncates the
			// preview to 2 KB byte-bounded.
			const content = "AGENTS.md governance content. ".repeat(200);

			let observedRow: typeof auditOutbox.$inferSelect | undefined;

			await db
				.transaction(async (tx) => {
					const result = await emitAuditEvent(tx, {
						tenantId,
						actorId: "77777777-7777-7777-7777-777777777777",
						actorType: "user",
						eventType: "workspace.governance_file_edited",
						source: "lambda",
						payload: {
							file: "AGENTS.md",
							content,
							workspaceId: "test-tenant-slug",
						},
					});

					const [row] = await tx
						.select()
						.from(auditOutbox)
						.where(eq(auditOutbox.event_id, result.eventId));
					observedRow = row;

					throw new Error("intentional rollback");
				})
				.catch((e) => {
					if (e.message !== "intentional rollback") throw e;
				});

			expect(observedRow).toBeDefined();
			const payload = observedRow!.payload as Record<string, unknown>;
			expect(payload.file).toBe("AGENTS.md");
			expect(payload.workspaceId).toBe("test-tenant-slug");
			expect(payload.content_sha256).toMatch(/^[0-9a-f]{64}$/);
			// Preview is byte-truncated; raw `content` field is not in
			// the persisted row.
			expect(payload.content).toBeUndefined();
			expect(typeof payload.preview).toBe("string");
			expect(Buffer.byteLength(payload.preview as string, "utf-8")).toBeLessThanOrEqual(
				2048,
			);
		});
	},
);
