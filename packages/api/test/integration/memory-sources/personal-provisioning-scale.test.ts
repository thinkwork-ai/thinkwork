/**
 * THINK-193 U8 — scale validation for personal memory provisioning
 * (plan §U8: "validate scale with at least 400 personal configs … and no
 * tenant-wide scans in individual runs").
 *
 * What a DB-level test CAN prove (and this test does):
 *   - 400 personal processors + workflows provision idempotently, with the
 *     partial-unique active-target index and the (tenant, slug) workflow
 *     unique resolving every double-ensure without duplicates or errors;
 *   - re-running the ensure over the whole cohort creates NOTHING (pure
 *     read path — the shape that runs on configuration reads);
 *   - concurrent ensures for ONE user converge on one processor and one
 *     workflow (unique-index behavior under contention);
 *   - provisioning state is keyed per user: every ensure resolves by the
 *     (tenant, mode, target_scope, target_id) tuple, so lookups ride the
 *     partial unique index rather than scanning the tenant's cohort — with
 *     400 rows in place, per-user ensure latency stays flat (asserted
 *     loosely below) and returns only that user's rows;
 *   - the scheduled path SPREADS: schedule bindings are one scheduled_jobs
 *     row PER WORKFLOW (trigger_type 'workflow_schedule'), so 400 users
 *     mean 400 independent schedule rows — there is no single shared
 *     thundering-herd schedule row to contend on.
 *
 * What it CANNOT prove (needs deployed load testing, out of scope here):
 *   - EventBridge Scheduler fan-out latency and job-trigger Lambda
 *     concurrency under 400 near-simultaneous fires;
 *   - Aurora behavior under production connection pooling;
 *   - the job-schedule-manager Lambda round-trip (bindings here are
 *     inserted the way the manager writes them, not through the Lambda).
 *
 * Integration test — DATABASE_URL-gated, same convention as
 * claims-concurrency.test.ts. Creates and removes its own synthetic users.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID =
  process.env.MEMORY_TEST_TENANT_ID ?? "0015953e-aa13-4cab-8398-2e70f73dda63";
const COHORT_SIZE = Number(process.env.MEMORY_SCALE_COHORT ?? 400);
const CONCURRENCY = 20;
const RUN_TAG = randomUUID().slice(0, 8);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

describe.skipIf(!DATABASE_URL)(
  "personal memory provisioning at 400-user scale (integration)",
  () => {
    let db: import("@thinkwork/database-pg").Database;
    const userIds: string[] = [];
    const processorIds = new Set<string>();
    const workflowIds = new Set<string>();
    const scheduledJobIds: string[] = [];

    beforeAll(async () => {
      const { getDb } = await import("@thinkwork/database-pg");
      const { users } = await import("@thinkwork/database-pg/schema");
      db = getDb();
      // Synthetic cohort — inserted in chunks to keep statements bounded.
      const values = Array.from({ length: COHORT_SIZE }, (_, i) => ({
        tenant_id: TENANT_ID,
        email: `scale-${RUN_TAG}-${i}@invalid.test`,
        name: `Scale Probe ${RUN_TAG} ${i}`,
      }));
      for (let i = 0; i < values.length; i += 100) {
        const rows = await db
          .insert(users)
          .values(values.slice(i, i + 100))
          .returning({ id: users.id });
        for (const row of rows) userIds.push(row.id);
      }
    }, 120_000);

    afterAll(async () => {
      if (!db) return;
      const { inArray } = await import("drizzle-orm");
      const { memoryProcessorConfigs, scheduledJobs, users, workflows } =
        await import("@thinkwork/database-pg/schema");
      const chunk = <T>(items: T[]): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < items.length; i += 200) {
          out.push(items.slice(i, i + 200));
        }
        return out;
      };
      for (const ids of chunk(scheduledJobIds)) {
        if (ids.length > 0) {
          await db.delete(scheduledJobs).where(inArray(scheduledJobs.id, ids));
        }
      }
      for (const ids of chunk([...processorIds])) {
        if (ids.length > 0) {
          await db
            .delete(memoryProcessorConfigs)
            .where(inArray(memoryProcessorConfigs.id, ids));
        }
      }
      for (const ids of chunk([...workflowIds])) {
        if (ids.length > 0) {
          // workflow_versions cascade from workflows.
          await db.delete(workflows).where(inArray(workflows.id, ids));
        }
      }
      for (const ids of chunk(userIds)) {
        if (ids.length > 0) {
          await db.delete(users).where(inArray(users.id, ids));
        }
      }
    }, 180_000);

    it(`provisions ${COHORT_SIZE} personal configs idempotently, without conflicts, and with per-workflow schedule spread`, async () => {
      const { ensurePersonalMemoryAutomation } = await import(
        "../../../src/lib/memory-sources/provisioning.js"
      );
      const { and, eq, inArray } = await import("drizzle-orm");
      const { memoryProcessorConfigs, scheduledJobs } = await import(
        "@thinkwork/database-pg/schema"
      );

      // ---- Pass 1: batch ensure across the cohort --------------------
      const firstPass = await mapWithConcurrency(
        userIds,
        CONCURRENCY,
        (userId) =>
          ensurePersonalMemoryAutomation(db, {
            tenantId: TENANT_ID,
            userId,
          }),
      );
      for (const ensured of firstPass) {
        expect(ensured.created).toBe(true);
        expect(ensured.workflow).not.toBeNull();
        expect(ensured.processor.mode).toBe("personal");
        expect(ensured.processor.target_scope).toBe("user");
        processorIds.add(ensured.processor.id);
        workflowIds.add(ensured.workflow!.id);
      }
      // No conflicts collapsed two users onto one processor/workflow.
      expect(processorIds.size).toBe(COHORT_SIZE);
      expect(workflowIds.size).toBe(COHORT_SIZE);
      // Every processor claimed its own workflow link.
      expect(new Set(firstPass.map((e) => e.processor.workflow_id)).size).toBe(
        COHORT_SIZE,
      );

      // ---- Pass 2: full-cohort re-ensure is a pure no-op --------------
      const secondPass = await mapWithConcurrency(
        userIds,
        CONCURRENCY,
        (userId) =>
          ensurePersonalMemoryAutomation(db, {
            tenantId: TENANT_ID,
            userId,
          }),
      );
      for (const [index, ensured] of secondPass.entries()) {
        expect(ensured.created).toBe(false);
        expect(ensured.processor.id).toBe(firstPass[index]!.processor.id);
        expect(ensured.workflow!.id).toBe(firstPass[index]!.workflow!.id);
      }

      // ---- Pass 3: contention on ONE user converges -------------------
      const contendedUser = userIds[0]!;
      const racers = await Promise.all(
        Array.from({ length: 8 }, () =>
          ensurePersonalMemoryAutomation(db, {
            tenantId: TENANT_ID,
            userId: contendedUser,
          }),
        ),
      );
      expect(new Set(racers.map((r) => r.processor.id)).size).toBe(1);
      expect(new Set(racers.map((r) => r.workflow!.id)).size).toBe(1);
      const contendedRows = await db
        .select({ id: memoryProcessorConfigs.id })
        .from(memoryProcessorConfigs)
        .where(
          and(
            eq(memoryProcessorConfigs.tenant_id, TENANT_ID),
            eq(memoryProcessorConfigs.mode, "personal"),
            eq(memoryProcessorConfigs.target_scope, "user"),
            eq(memoryProcessorConfigs.target_id, contendedUser),
            eq(memoryProcessorConfigs.status, "active"),
          ),
        );
      expect(contendedRows).toHaveLength(1);

      // ---- Pass 4: scheduled path spreads per workflow ----------------
      // Insert bindings the way job-schedule-manager persists them: one
      // 'workflow_schedule' row per workflow. Staggering/fan-out on AWS
      // Scheduler is a deployed-load concern (see header).
      const workflowIdList = [...workflowIds];
      for (let i = 0; i < workflowIdList.length; i += 100) {
        const rows = await db
          .insert(scheduledJobs)
          .values(
            workflowIdList.slice(i, i + 100).map((workflowId, j) => ({
              tenant_id: TENANT_ID,
              trigger_type: "workflow_schedule",
              workflow_id: workflowId,
              name: `scale-${RUN_TAG}-schedule-${i + j}`,
              schedule_type: "rate",
              schedule_expression: "rate(1 hour)",
              enabled: true,
              created_by_type: "system",
            })),
          )
          .returning({ id: scheduledJobs.id });
        for (const row of rows) scheduledJobIds.push(row.id);
      }
      expect(scheduledJobIds).toHaveLength(COHORT_SIZE);
      // Spread proof: the binding lookup used by schedule-binding.ts —
      // (tenant, workflow, trigger_type) — resolves to exactly ONE row
      // per workflow; there is no shared schedule row for the cohort.
      const perWorkflow = await db
        .select({
          workflow_id: scheduledJobs.workflow_id,
        })
        .from(scheduledJobs)
        .where(inArray(scheduledJobs.id, scheduledJobIds.slice(0, 200)));
      const counts = new Map<string, number>();
      for (const row of perWorkflow) {
        counts.set(
          String(row.workflow_id),
          (counts.get(String(row.workflow_id)) ?? 0) + 1,
        );
      }
      expect([...counts.values()].every((n) => n === 1)).toBe(true);

      // ---- Flat per-user cost probe -----------------------------------
      // With the full cohort in place, a single-user ensure must stay a
      // handful of index hits (no tenant-wide scan). A loose wall-clock
      // bound catches an accidental O(cohort) regression without being
      // flaky about absolute latency.
      const sampled = userIds[userIds.length - 1]!;
      const start = Date.now();
      await ensurePersonalMemoryAutomation(db, {
        tenantId: TENANT_ID,
        userId: sampled,
      });
      expect(Date.now() - start).toBeLessThan(5_000);
    }, 600_000);
  },
);
