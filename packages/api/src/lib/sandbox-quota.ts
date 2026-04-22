/**
 * sandbox-quota — atomic circuit breaker for AgentCore Code Sandbox
 * invocations (plan Unit 10).
 *
 * Every execute_code call posts to /api/sandbox/quota/check-and-increment
 * BEFORE launching the interpreter session. The handler hits this module
 * which atomically increments the tenant-daily + agent-hourly counters.
 * Zero rows returned from the guarded UPSERT means the cap was breached.
 *
 * Key invariants (plan Unit 10):
 *
 *   1. **`< cap` semantics.** At cap=500 the 500th call succeeds; 501st
 *      is rejected. The guard runs on *pre-increment* count:
 *         UPDATE ... WHERE count < :cap
 *      so count=499 passes (becomes 500), count=500 fails.
 *
 *   2. **Server-side boundaries.** UTC date + hour computed inside SQL
 *      via CURRENT_DATE / date_trunc('hour', NOW()). A client-computed
 *      boundary would split an in-flight second at UTC midnight into
 *      two different rows under slight clock skew.
 *
 *   3. **Strict lock order.** tenant-daily FIRST, always, then
 *      agent-hourly. Reversing is how you deadlock at 400+ agents.
 *
 *   4. **Fail closed on deadlock.** SQLSTATE 40P01 / 40001 → reject with
 *      dimension='unknown' + 60s retry. A circuit breaker that
 *      fails-open is worse than useless.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

// Defaults — the plan's R-Q8 sizing, with a revisit trigger written into
// Operational Notes. Runtime caps override via
// /thinkwork/{stage}/sandbox/caps if the operator needs a pressure-release.
export const DEFAULT_TENANT_DAILY_CAP = 500;
export const DEFAULT_AGENT_HOURLY_CAP = 20;

// Deadlock retry-after window. Short enough to drain a contention spike
// without letting a poison-pill loop burn quota.
const DEADLOCK_RETRY_SECONDS = 60;

export type BreachDimension = "tenant_daily" | "agent_hourly" | "unknown";

export type QuotaResult =
  | { ok: true; tenantDailyCount: number; agentHourlyCount: number }
  | {
      ok: false;
      dimension: BreachDimension;
      /** ISO-8601 timestamp when the breach dimension's window resets. */
      resetsAt: string;
    };

export interface QuotaCaps {
  tenantDailyCap: number;
  agentHourlyCap: number;
}

export interface CheckAndIncrementInput {
  tenantId: string;
  agentId: string;
  /**
   * Override caps for this check. Production reads SSM
   * /thinkwork/{stage}/sandbox/caps; the handler normalizes to this
   * shape and passes through.
   */
  caps?: Partial<QuotaCaps>;
}

/**
 * Atomic tenant-daily + agent-hourly counter increment with a
 * pre-increment < cap guard. Returns structured ok / not-ok result.
 *
 * The caller MUST be the narrow REST endpoint, not a GraphQL resolver —
 * the service-endpoint pattern (Bearer API_AUTH_SECRET) keeps the
 * container from needing a resolver auth path.
 */
export async function checkAndIncrement(
  input: CheckAndIncrementInput,
): Promise<QuotaResult> {
  const caps: QuotaCaps = {
    tenantDailyCap: input.caps?.tenantDailyCap ?? DEFAULT_TENANT_DAILY_CAP,
    agentHourlyCap: input.caps?.agentHourlyCap ?? DEFAULT_AGENT_HOURLY_CAP,
  };

  const db = getDb();
  try {
    // Single transaction so one rollback unwinds both counter writes.
    return await db.transaction(async (tx) => {
      // --- tenant-daily first (strict lock order) ---
      const tenantDaily = await tx.execute(sql`
        INSERT INTO sandbox_tenant_daily_counters
          (tenant_id, utc_date, invocations_count, updated_at)
        VALUES
          (${input.tenantId}::uuid, CURRENT_DATE, 1, NOW())
        ON CONFLICT (tenant_id, utc_date) DO UPDATE
          SET invocations_count = sandbox_tenant_daily_counters.invocations_count + 1,
              updated_at = NOW()
          WHERE sandbox_tenant_daily_counters.invocations_count < ${caps.tenantDailyCap}
        RETURNING invocations_count
      `);

      const tenantDailyRow = firstRow(tenantDaily);
      if (!tenantDailyRow) {
        // Guard failed (pre-increment count >= tenantDailyCap).
        // Rollback is implicit — we haven't touched agent-hourly yet.
        const resetsAt = tomorrowUtcMidnight();
        logBreach({
          dimension: "tenant_daily",
          tenantId: input.tenantId,
          agentId: input.agentId,
          resetsAt,
          caps,
        });
        throw new BreachThrow("tenant_daily", resetsAt);
      }

      // --- agent-hourly second (strict lock order) ---
      const agentHourly = await tx.execute(sql`
        INSERT INTO sandbox_agent_hourly_counters
          (tenant_id, agent_id, utc_hour, invocations_count, updated_at)
        VALUES
          (${input.tenantId}::uuid, ${input.agentId}::uuid,
           date_trunc('hour', NOW()), 1, NOW())
        ON CONFLICT (tenant_id, agent_id, utc_hour) DO UPDATE
          SET invocations_count = sandbox_agent_hourly_counters.invocations_count + 1,
              updated_at = NOW()
          WHERE sandbox_agent_hourly_counters.invocations_count < ${caps.agentHourlyCap}
        RETURNING invocations_count
      `);

      const agentHourlyRow = firstRow(agentHourly);
      if (!agentHourlyRow) {
        // Guard failed. Rollback unwinds the tenant-daily increment we
        // already did — the transaction keeps the two counters consistent.
        const resetsAt = nextHourUtc();
        logBreach({
          dimension: "agent_hourly",
          tenantId: input.tenantId,
          agentId: input.agentId,
          resetsAt,
          caps,
        });
        throw new BreachThrow("agent_hourly", resetsAt);
      }

      return {
        ok: true as const,
        tenantDailyCount: toNumber(tenantDailyRow.invocations_count),
        agentHourlyCount: toNumber(agentHourlyRow.invocations_count),
      };
    });
  } catch (err) {
    if (err instanceof BreachThrow) {
      return { ok: false, dimension: err.dimension, resetsAt: err.resetsAt };
    }
    // Deadlock / serialization failure → fail closed.
    const code = sqlStateOf(err);
    if (code === "40P01" || code === "40001") {
      const resetsAt = new Date(
        Date.now() + DEADLOCK_RETRY_SECONDS * 1000,
      ).toISOString();
      logBreach({
        dimension: "unknown",
        tenantId: input.tenantId,
        agentId: input.agentId,
        resetsAt,
        caps,
        note: `deadlock ${code}`,
      });
      return { ok: false, dimension: "unknown", resetsAt };
    }
    // Anything else: bubble so the handler returns 500. Better the
    // tool call fails loud than silently bypasses the breaker.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function tomorrowUtcMidnight(now: Date = new Date()): string {
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return tomorrow.toISOString();
}

export function nextHourUtc(now: Date = new Date()): string {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
      0,
      0,
      0,
    ),
  );
  return next.toISOString();
}

export function sqlStateOf(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const anyErr = err as { code?: unknown; sqlState?: unknown };
    if (typeof anyErr.code === "string") return anyErr.code;
    if (typeof anyErr.sqlState === "string") return anyErr.sqlState;
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

function firstRow(
  result: unknown,
): { invocations_count: number | string } | undefined {
  // pg / drizzle return shapes vary: some return `{ rows: [...] }`, some
  // return the rows array directly. Accept both so a driver swap doesn't
  // silently break the guard (fail-open would be the worst outcome).
  if (Array.isArray(result)) return result[0];
  const anyResult = result as { rows?: Array<{ invocations_count: number }> };
  return anyResult.rows?.[0];
}

class BreachThrow extends Error {
  dimension: BreachDimension;
  resetsAt: string;
  constructor(dimension: BreachDimension, resetsAt: string) {
    super(`sandbox cap breach: ${dimension}`);
    this.dimension = dimension;
    this.resetsAt = resetsAt;
  }
}

// Structured log for the revisit-trigger signal (plan R-Q8). Operators
// query this in CloudWatch after 7 / 30 days to decide whether to raise
// the default caps.
function logBreach(record: {
  dimension: BreachDimension;
  tenantId: string;
  agentId: string;
  resetsAt: string;
  caps: QuotaCaps;
  note?: string;
}): void {
  console.warn(
    "[sandbox-quota] SandboxCapExceeded",
    JSON.stringify({
      dimension: record.dimension,
      tenant_id: record.tenantId,
      agent_id: record.agentId,
      resets_at: record.resetsAt,
      tenant_daily_cap: record.caps.tenantDailyCap,
      agent_hourly_cap: record.caps.agentHourlyCap,
      note: record.note,
    }),
  );
}
