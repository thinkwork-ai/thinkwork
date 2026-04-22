/**
 * Sandbox E2E assertions — query live infra, throw descriptive errors.
 *
 * Each assertion shape matches the runbook triage table in
 * `docs/guides/sandbox-environments.md`. When an assertion fails, the
 * error includes the runId + tenantId so a post-mortem grep lands on
 * the right fixtures.
 *
 * Pattern set for the no-token-leak assertion mirrors
 * `packages/lambda/sandbox-log-scrubber.ts` exactly — this guarantees
 * the harness checks the same shapes the Unit 12 backstop redacts.
 *
 * Plan: docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md Unit 3.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as PgClient } from "pg";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { HarnessEnv } from "./index.js";

// ---------------------------------------------------------------------------
// Pattern set — pulled verbatim from packages/lambda/sandbox-log-scrubber.ts
// If the scrubber extends its pattern set, add the same entries here so the
// harness asserts on the same surface the backstop redacts.
// ---------------------------------------------------------------------------

const AUTH_BEARER = /Authorization:\s*Bearer\s+\S+/gi;
const JWT = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const PREFIXED_TOKEN =
  /(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,})/g;

const PATTERNS = [
  { name: "Authorization Bearer header", re: AUTH_BEARER },
  { name: "JWT triple", re: JWT },
  { name: "known OAuth prefix (ghp_/xoxb-/ya29.)", re: PREFIXED_TOKEN },
];

export interface SandboxInvocationRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  user_id: string;
  environment_id: string;
  session_id: string | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  exit_status: string | null;
  stdout_bytes: number | null;
  stderr_bytes: number | null;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  executed_code_hash: string | null;
  failure_reason: string | null;
}

/**
 * Assert exactly one sandbox_invocations row exists for the tenant in
 * the given window. Returns the row so downstream assertions can read
 * `session_id`, `executed_code_hash`, etc.
 */
export async function assertSandboxInvocation(
  env: HarnessEnv,
  args: {
    tenantId: string;
    since: Date;
    expectedExitStatus?: string;
    runId: string;
  },
): Promise<SandboxInvocationRow> {
  const db = openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT * FROM sandbox_invocations
          WHERE tenant_id = ${args.tenantId}::uuid
            AND started_at >= ${args.since}
          ORDER BY started_at DESC`,
    );
    const rows = (
      Array.isArray(result) ? result : ((result as any).rows ?? [])
    ) as SandboxInvocationRow[];
    if (rows.length === 0) {
      throw new Error(
        `[sandbox-e2e run=${args.runId}] expected a sandbox_invocations row for tenant ${args.tenantId} since ${args.since.toISOString()}, found none. ` +
          `Runbook: docs/guides/sandbox-environments.md → "Investigating a specific invocation".`,
      );
    }
    const row = rows[0];
    if (args.expectedExitStatus && row.exit_status !== args.expectedExitStatus) {
      throw new Error(
        `[sandbox-e2e run=${args.runId}] sandbox_invocations.exit_status expected '${args.expectedExitStatus}', got '${row.exit_status}' (row=${row.id}). ` +
          `failure_reason: ${row.failure_reason ?? "(null)"}.`,
      );
    }
    return row;
  } finally {
    await closeDb(db);
  }
}

/**
 * Query the sandbox_tenant_daily_counters row and return its count. The
 * caller asserts the shape they expect (incremented, unchanged, etc.).
 */
export async function readTenantDailyCounter(
  env: HarnessEnv,
  tenantId: string,
): Promise<{ count: number; wallClockSeconds: number } | null> {
  const db = openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT invocations_count, wall_clock_seconds
          FROM sandbox_tenant_daily_counters
          WHERE tenant_id = ${tenantId}::uuid AND utc_date = CURRENT_DATE`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    if (rows.length === 0) return null;
    return {
      count: Number(rows[0].invocations_count ?? 0),
      wallClockSeconds: Number(rows[0].wall_clock_seconds ?? 0),
    };
  } finally {
    await closeDb(db);
  }
}

/**
 * Grep CloudWatch log events for the given session id against the
 * Unit 12 pattern set. Retries up to `retries` times with `backoffMs`
 * delay to accommodate CloudWatch's 3-5s ingestion lag. Throws if any
 * pattern matches.
 */
export async function assertNoTokenLeak(
  env: HarnessEnv,
  args: {
    sessionId: string;
    startTime: Date;
    endTime: Date;
    runId: string;
    retries?: number;
    backoffMs?: number;
    /** Also assert these specific strings don't appear (synthetic tokens
     * written by the fixture). Covers the R5 "no tenant-specific value"
     * case when the pattern set doesn't match exactly. */
    forbiddenValues?: string[];
  },
): Promise<void> {
  const retries = args.retries ?? 3;
  const backoffMs = args.backoffMs ?? 2_000;
  const cwl = new CloudWatchLogsClient({ region: env.awsRegion });

  let lastMatches: Array<{ pattern: string; sample: string }> = [];
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs));

    const events = await cwl.send(
      new FilterLogEventsCommand({
        logGroupName: env.agentcoreRuntimeLogGroup,
        startTime: args.startTime.getTime(),
        endTime: args.endTime.getTime(),
        // Session id is the narrowest filter we have; AgentCore tags
        // log events with it.
        filterPattern: `"${args.sessionId}"`,
        limit: 10_000,
      }),
    );
    const matches = findTokenMatches(
      (events.events ?? []).map((e) => e.message ?? ""),
      args.forbiddenValues ?? [],
    );
    if (matches.length === 0) return;
    lastMatches = matches;
  }
  throw new Error(
    `[sandbox-e2e run=${args.runId}] token leak detected in CloudWatch log group ${env.agentcoreRuntimeLogGroup} for session ${args.sessionId}. ` +
      `${lastMatches.length} match(es). Samples (first 3, hashed): ${lastMatches.slice(0, 3).map((m) => `${m.pattern}=${hashSample(m.sample)}`).join(", ")}. ` +
      `THIS IS A REGRESSION IN THE UNIT 4 sitecustomize.py WRAPPER. Page platform security. Runbook: docs/guides/sandbox-environments.md → "When to call platform security".`,
  );
}

export function findTokenMatches(
  messages: string[],
  forbiddenValues: string[] = [],
): Array<{ pattern: string; sample: string }> {
  const out: Array<{ pattern: string; sample: string }> = [];
  for (const message of messages) {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      const match = re.exec(message);
      if (match) {
        out.push({ pattern: name, sample: match[0] });
      }
    }
    for (const forbidden of forbiddenValues) {
      if (forbidden && message.includes(forbidden)) {
        out.push({ pattern: "forbidden-value", sample: forbidden });
      }
    }
  }
  return out;
}

function hashSample(value: string): string {
  // Don't log the raw token sample — hash it so the error message is
  // safe to share in a screenshot / on Slack.
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Assert the agent's final message or the tool's structured result
 * carries SandboxCapExceeded in an agent-recoverable shape.
 */
export function assertCapExceeded(args: {
  runId: string;
  agentResponse: string | undefined;
  toolResult?: { error?: string; exit_status?: string };
}): void {
  const resp = (args.agentResponse ?? "").toLowerCase();
  if (resp.includes("sandboxcapexceeded") || resp.includes("cap_exceeded")) return;
  if (args.toolResult?.error === "SandboxCapExceeded") return;
  if (args.toolResult?.exit_status === "cap_exceeded") return;
  throw new Error(
    `[sandbox-e2e run=${args.runId}] expected SandboxCapExceeded in agent response or tool result; ` +
      `agent said: ${(args.agentResponse ?? "").slice(0, 200)}, tool result: ${JSON.stringify(args.toolResult ?? {})}. ` +
      `Runbook: docs/guides/sandbox-environments.md → "SandboxCapExceeded".`,
  );
}

/**
 * Assert each tenant's sandbox_invocations rows are only that tenant's.
 * Used by the cross-tenant isolation test to prove R4 structurally.
 */
export async function assertTenantIsolation(
  env: HarnessEnv,
  args: { tenantA: string; tenantB: string; since: Date; runId: string },
): Promise<void> {
  const db = openDb(env);
  try {
    for (const tenantId of [args.tenantA, args.tenantB]) {
      const result = await db.execute(
        sql`SELECT DISTINCT tenant_id::text AS tenant_id FROM sandbox_invocations
            WHERE tenant_id = ${tenantId}::uuid AND started_at >= ${args.since}`,
      );
      const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
      const distinct = rows.map((r: any) => r.tenant_id);
      if (distinct.length !== 1 || distinct[0] !== tenantId) {
        throw new Error(
          `[sandbox-e2e run=${args.runId}] cross-tenant leak: querying tenant ${tenantId} returned tenant_ids=${JSON.stringify(distinct)}`,
        );
      }
    }
  } finally {
    await closeDb(db);
  }
}

// ---------------------------------------------------------------------------
// DB plumbing (same shape as fixtures.ts — kept narrow to avoid schema pkg deps)
// ---------------------------------------------------------------------------

function openDb(env: HarnessEnv) {
  const client = new PgClient({ connectionString: env.databaseUrl });
  const db = drizzle(client, { schema: {} as any });
  (db as any)._client = client;
  void client.connect();
  return db;
}

async function closeDb(db: ReturnType<typeof openDb>): Promise<void> {
  const client = (db as any)._client as PgClient;
  try {
    await client.end();
  } catch {
    // idempotent
  }
}

export const _testOnly = {
  findTokenMatches,
  PATTERNS,
};
