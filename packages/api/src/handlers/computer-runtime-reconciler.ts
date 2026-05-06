import type { ScheduledEvent } from "aws-lambda";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { computerEvents, computers } from "@thinkwork/database-pg/schema";
import {
  controlComputerRuntime,
  type RuntimeAction,
} from "../lib/computers/runtime-control.js";

const db = getDb();

type ComputerRuntimeRow = {
  id: string;
  tenant_id: string;
  desired_runtime_status: string;
  runtime_status: string;
  ecs_service_name: string | null;
  last_heartbeat_at: Date | null;
};

export type ReconciliationAction = Extract<
  RuntimeAction,
  "provision" | "start" | "stop"
>;

export async function handler(_event: ScheduledEvent) {
  const limit = envNumber("COMPUTER_RUNTIME_RECONCILE_BATCH_SIZE", 25);
  const staleAfterMinutes = envNumber(
    "COMPUTER_RUNTIME_STALE_AFTER_MINUTES",
    15,
  );
  const staleBefore = new Date(Date.now() - staleAfterMinutes * 60_000);
  const rows = await selectReconciliationCandidates({ limit, staleBefore });
  const results = [];

  for (const row of rows) {
    const action = planComputerRuntimeReconciliation(
      row,
      new Date(),
      staleAfterMinutes * 60_000,
    );
    if (!action) continue;
    try {
      const result = await controlComputerRuntime({
        action,
        tenantId: row.tenant_id,
        computerId: row.id,
      });
      await recordReconcileEvent(row, "computer_runtime_reconcile_succeeded", {
        action,
        result,
      });
      results.push({ computerId: row.id, action, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordReconcileEvent(row, "computer_runtime_reconcile_failed", {
        action,
        message,
      });
      results.push({ computerId: row.id, action, ok: false, error: message });
    }
  }

  console.log(
    JSON.stringify({
      msg: "computer-runtime-reconciler.complete",
      candidates: rows.length,
      reconciled: results.length,
      failed: results.filter((result) => !result.ok).length,
    }),
  );

  return { ok: true, candidates: rows.length, results };
}

export function planComputerRuntimeReconciliation(
  row: ComputerRuntimeRow,
  now: Date,
  staleAfterMs = 15 * 60_000,
): ReconciliationAction | null {
  if (row.desired_runtime_status === "stopped") {
    if (!row.ecs_service_name || row.runtime_status === "stopped") return null;
    return "stop";
  }

  if (row.desired_runtime_status !== "running") return null;
  if (!row.ecs_service_name) return "provision";
  if (row.runtime_status === "stopped" || row.runtime_status === "unknown") {
    return "start";
  }
  if (row.runtime_status === "running") {
    if (!row.last_heartbeat_at) return "provision";
    if (now.getTime() - row.last_heartbeat_at.getTime() > staleAfterMs) {
      return "provision";
    }
  }
  return null;
}

async function selectReconciliationCandidates(input: {
  limit: number;
  staleBefore: Date;
}) {
  return db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      desired_runtime_status: computers.desired_runtime_status,
      runtime_status: computers.runtime_status,
      ecs_service_name: computers.ecs_service_name,
      last_heartbeat_at: computers.last_heartbeat_at,
    })
    .from(computers)
    .where(
      and(
        eq(computers.status, "active"),
        or(
          and(
            eq(computers.desired_runtime_status, "running"),
            or(
              eq(computers.runtime_status, "pending"),
              eq(computers.runtime_status, "stopped"),
              eq(computers.runtime_status, "unknown"),
              eq(computers.runtime_status, "failed"),
              isNull(computers.last_heartbeat_at),
              lt(computers.last_heartbeat_at, input.staleBefore),
            ),
          ),
          and(
            eq(computers.desired_runtime_status, "stopped"),
            inArray(computers.runtime_status, ["starting", "running"]),
          ),
        ),
      ),
    )
    .orderBy(asc(computers.updated_at))
    .limit(input.limit);
}

async function recordReconcileEvent(
  row: ComputerRuntimeRow,
  eventType: string,
  payload: unknown,
) {
  await db.insert(computerEvents).values({
    tenant_id: row.tenant_id,
    computer_id: row.id,
    event_type: eventType,
    level: eventType.endsWith("_failed") ? "error" : "info",
    payload,
  });
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
