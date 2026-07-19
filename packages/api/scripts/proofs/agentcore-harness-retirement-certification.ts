#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  evaluateRetirementCertification,
  REQUIRED_RETIREMENT_SURFACES,
  type EvalEvidence,
  type RetirementCertificationInput,
  type RuntimeType,
  type RuntimeWindowStats,
  type SurfaceEvidence,
} from "../../src/lib/harness/retirement-certification.js";

interface Args {
  tenantId: string;
  since: Date;
  until: Date;
  cases: Array<{ surface: string; threadId: string; turnId?: string }>;
  evals: Array<{ runtimeType: RuntimeType; runId: string }>;
  minimumHours: number;
  minimumSuccessRate: number;
  maximumP95DurationMs: number;
  canaries: string[];
  rollbackRehearsed: boolean;
  capacityAdmitted: boolean;
  json: boolean;
}

interface TurnRow {
  id: string;
  thread_id: string;
  runtime_type: string | null;
  status: string;
  finalized: boolean;
  usage_present: boolean;
  goal_evidence: boolean;
  invocation_source: string;
  trigger_id: string | null;
}

interface ToolRow {
  idempotency_key: string;
  operation: string;
  principal_id: string;
  credential_owner_alias: string | null;
  event_type: string;
  preview: string;
}

interface SurfaceCounts {
  artifact_count: string;
  attachment_count: string;
  retained_memory_count: string;
  question_resume_count: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage(exitCode = 2): never {
  console.error(`Usage:
  DATABASE_URL=... pnpm --filter @thinkwork/api agentcore:retirement-certify -- \\
    --tenant-id <uuid> --since <iso> [--until <iso>] \\
    --case multiplayer-eric=<thread-uuid>@<turn-uuid> \\
    --case multiplayer-sursum=<thread-uuid>@<turn-uuid> \\
    --eval pi=<run-uuid> --eval agentcore=<run-uuid> \\
    [--minimum-hours 24] [--minimum-success-rate 0.95] \\
    [--maximum-p95-ms 120000] [--capacity-admitted] [--rollback-rehearsed] [--json]

HARNESS_CERTIFICATION_CANARIES must contain comma-separated injected canaries
for a final PASS. Missing live surfaces, capacity evidence, rollback evidence,
or an incomplete soak produce IN_PROGRESS; observed safety violations produce
FAIL. The command never changes a tenant runtime or deletes Pi.`);
  process.exit(exitCode);
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  let tenantId = process.env.THINKWORK_TENANT_ID || "";
  let since: Date | null = null;
  let until = new Date();
  let minimumHours = 24;
  let minimumSuccessRate = 0.95;
  let maximumP95DurationMs = 120_000;
  let rollbackRehearsed = false;
  let capacityAdmitted = false;
  let json = false;
  const cases: Args["cases"] = [];
  const evals: Args["evals"] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--tenant-id") tenantId = argv[++index] || "";
    else if (arg === "--since") since = new Date(argv[++index] || "");
    else if (arg === "--until") until = new Date(argv[++index] || "");
    else if (arg === "--minimum-hours") minimumHours = Number(argv[++index]);
    else if (arg === "--minimum-success-rate") {
      minimumSuccessRate = Number(argv[++index]);
    } else if (arg === "--maximum-p95-ms") {
      maximumP95DurationMs = Number(argv[++index]);
    } else if (arg === "--capacity-admitted") capacityAdmitted = true;
    else if (arg === "--rollback-rehearsed") rollbackRehearsed = true;
    else if (arg === "--json") json = true;
    else if (arg === "--case") {
      const [surface, location, ...extra] = (argv[++index] || "").split("=");
      const [threadId, turnId, ...locationExtra] = (location || "").split("@");
      if (
        !surface ||
        !UUID.test(threadId || "") ||
        (turnId != null && !UUID.test(turnId)) ||
        extra.length ||
        locationExtra.length
      ) {
        usage();
      }
      cases.push({
        surface,
        threadId: threadId!.toLowerCase(),
        ...(turnId ? { turnId: turnId.toLowerCase() } : {}),
      });
    } else if (arg === "--eval") {
      const [runtimeType, runId, ...extra] = (argv[++index] || "").split("=");
      if (
        (runtimeType !== "pi" && runtimeType !== "agentcore") ||
        !UUID.test(runId || "") ||
        extra.length
      ) {
        usage();
      }
      evals.push({
        runtimeType,
        runId: runId!.toLowerCase(),
      });
    } else usage();
  }

  const canaries = (process.env.HARNESS_CERTIFICATION_CANARIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedSurfaces = cases.map((item) => item.surface);
  const requestedEvalRuntimes = evals.map((item) => item.runtimeType);
  if (
    !process.env.DATABASE_URL ||
    !UUID.test(tenantId) ||
    !since ||
    Number.isNaN(since.getTime()) ||
    Number.isNaN(until.getTime()) ||
    until <= since ||
    minimumHours <= 0 ||
    minimumSuccessRate <= 0 ||
    minimumSuccessRate > 1 ||
    maximumP95DurationMs <= 0 ||
    requestedSurfaces.some(
      (surface) =>
        !REQUIRED_RETIREMENT_SURFACES.includes(
          surface as (typeof REQUIRED_RETIREMENT_SURFACES)[number],
        ),
    ) ||
    new Set(requestedSurfaces).size !== requestedSurfaces.length ||
    new Set(requestedEvalRuntimes).size !== requestedEvalRuntimes.length
  ) {
    usage();
  }
  return {
    tenantId,
    since,
    until,
    cases,
    evals,
    minimumHours,
    minimumSuccessRate,
    maximumP95DurationMs,
    canaries,
    rollbackRehearsed,
    capacityAdmitted,
    json,
  };
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function poolConfig(databaseUrl: string): pg.PoolConfig {
  const parsed = new URL(databaseUrl);
  if (parsed.searchParams.get("sslmode") !== "no-verify") {
    return { connectionString: databaseUrl };
  }
  parsed.searchParams.delete("sslmode");
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  };
}

function completedToolRows(rows: ToolRow[]): ToolRow[] {
  const started = new Set(
    rows
      .filter((row) => row.event_type === "started")
      .map((row) => row.idempotency_key),
  );
  return rows.filter(
    (row) => row.event_type === "completed" && started.has(row.idempotency_key),
  );
}

function terminalOperations(rows: ToolRow[]): string[] {
  return unique(completedToolRows(rows).map((row) => row.operation));
}

function containsEvidence(
  turn: TurnRow,
  toolRows: ToolRow[],
  extra: {
    artifactCount: number;
    attachmentCount: number;
    retainedMemoryCount: number;
    questionResumeCount: number;
  },
  surface: string,
): { ok: boolean; detail: string } {
  const completedRows = completedToolRows(toolRows);
  const completed = unique(completedRows.map((row) => row.operation));
  const haystack = `${completed.join(" ")} ${completedRows
    .map((row) => row.preview)
    .join(" ")}`.toLowerCase();
  const operation = (pattern: RegExp) => pattern.test(haystack);
  const result = (() => {
    switch (surface) {
      case "multiplayer-eric":
      case "multiplayer-sursum":
        return {
          ok: true,
          detail: "completed participant-scoped Harness session",
        };
      case "skills":
        return {
          ok: operation(/workspace\.skills\.load|workspace_skill/),
          detail: "workspace skill load",
        };
      case "memory":
        return {
          ok: extra.retainedMemoryCount > 0,
          detail: `${extra.retainedMemoryCount} retained memory ledger records`,
        };
      case "attachments":
        return {
          ok: extra.attachmentCount > 0 && operation(/attachment/),
          detail: `${extra.attachmentCount} attachments with governed read evidence`,
        };
      case "artifact":
        return {
          ok: extra.artifactCount > 0,
          detail: `${extra.artifactCount} durable artifacts`,
        };
      case "question-resume":
        return {
          ok:
            turn.invocation_source === "question_answer" &&
            extra.questionResumeCount > 0,
          detail: `${extra.questionResumeCount} card answer -> AgentCore resume chains`,
        };
      case "goal":
        return {
          ok: turn.goal_evidence,
          detail: "persisted terminal goal_run evidence",
        };
      case "lastmile":
        return {
          ok: operation(/lastmile/),
          detail: "LastMile target evidence",
        };
      case "twenty-eric":
      case "twenty-sursum":
        return {
          ok: operation(/twenty/),
          detail: "Twenty target and credential evidence",
        };
      case "web-search":
        return {
          ok: operation(/web[._ -]?search|exa/),
          detail: "governed web search",
        };
      case "web-extract":
        return {
          ok: operation(/web[._ -]?extract|firecrawl/),
          detail: "governed web extraction",
        };
      case "brain":
        return {
          ok: operation(/brain|knowledge[._ -]?graph/),
          detail: "ThinkWork Brain evidence",
        };
      case "email":
        return {
          ok: operation(/send[._ -]?email|email\.send/),
          detail: "governed email evidence",
        };
      case "browser":
        return {
          ok: operation(/browser/),
          detail: "governed browser evidence",
        };
      case "sandbox":
        return {
          ok: operation(/sandbox\.execute_code|execute_code/),
          detail: "governed sandbox evidence",
        };
      case "automation":
        return {
          ok: /workflow|automation|wakeup/.test(turn.invocation_source),
          detail: `invocation_source=${turn.invocation_source}`,
        };
      case "schedule":
        return {
          ok:
            Boolean(turn.trigger_id) || /schedule/.test(turn.invocation_source),
          detail: `invocation_source=${turn.invocation_source}, trigger=${Boolean(turn.trigger_id)}`,
        };
      default:
        return { ok: true, detail: "generic authoritative turn evidence" };
    }
  })();
  return result;
}

export async function loadSurfaceEvidence(
  pool: pg.Pool,
  args: Args,
  item: Args["cases"][number],
): Promise<SurfaceEvidence> {
  const { rows } = await pool.query<TurnRow>(
    `SELECT id, thread_id, runtime_type, status,
            finalized_at IS NOT NULL AS finalized,
            usage_json IS NOT NULL AS usage_present,
            COALESCE(result_json->'goal_run'->>'status', usage_json->'goal_run'->>'status', '')
              IN ('complete', 'completed', 'cleared', 'budget_limited') AS goal_evidence,
            invocation_source, trigger_id::text
      FROM thread_turns
      WHERE tenant_id = $1 AND thread_id = $2
        AND ($3::uuid IS NULL OR id = $3::uuid)
        AND created_at >= $4 AND created_at < $5
      ORDER BY created_at DESC
      LIMIT 1`,
    [args.tenantId, item.threadId, item.turnId ?? null, args.since, args.until],
  );
  const turn = rows[0];
  if (!turn) {
    return {
      surface: item.surface,
      threadId: item.threadId,
      turnId: "missing",
      runtimeType: null,
      status: "missing",
      finalized: false,
      usagePresent: false,
      costRows: 0,
      piCostRows: 0,
      invocationSource: "missing",
      completedOperations: [],
      principalIds: [],
      credentialOwners: [],
      semanticEvidence: false,
      semanticDetail: "thread has no turn in the certification window",
    };
  }
  const [
    { rows: toolRows },
    { rows: costRows },
    { rows: extraRows },
    { rows: participantRows },
  ] = await Promise.all([
    pool.query<ToolRow>(
      `SELECT idempotency_key, operation, principal_id,
                credential_owner_alias, event_type,
                CONCAT_WS(' ', input_preview::text, output_preview::text,
                          error_preview::text) AS preview
           FROM harness_tool_execution_events
          WHERE tenant_id = $1 AND turn_id = $2
          ORDER BY id`,
      [args.tenantId, turn.id],
    ),
    pool.query<{ runtime_type: string | null }>(
      `SELECT runtime_type FROM cost_events WHERE tenant_id = $1 AND request_id = $2`,
      [args.tenantId, turn.id],
    ),
    pool.query<SurfaceCounts>(
      `SELECT
           (SELECT count(*) FROM artifacts artifact
              JOIN messages source_message ON source_message.id = artifact.source_message_id
             WHERE artifact.tenant_id = $1 AND artifact.thread_id = $2
               AND source_message.metadata->>'sourceTurnId' = $3::text) AS artifact_count,
           (SELECT count(*) FROM thread_attachments WHERE tenant_id = $1 AND thread_id = $2) AS attachment_count,
           (SELECT count(*) FROM brain.retain_attempts
             WHERE tenant_id = $1 AND thread_id = $2 AND thread_turn_id = $3::uuid
               AND status = 'retained') AS retained_memory_count,
           (SELECT count(*)
              FROM agent_wakeup_requests awr
              JOIN pending_user_questions pq
                ON pq.tenant_id = awr.tenant_id
               AND pq.id::text = awr.payload->>'questionId'
              JOIN thread_turns asking_turn
                ON asking_turn.tenant_id = pq.tenant_id
               AND asking_turn.id = pq.thread_turn_id
             WHERE awr.tenant_id = $1 AND awr.id = (
               SELECT wakeup_request_id FROM thread_turns
                WHERE tenant_id = $1 AND id = $3::uuid
             )
               AND awr.source = 'question_answer'
               AND awr.payload->>'runtimeType' = 'agentcore'
               AND pq.thread_id = $2 AND pq.status = 'answered'
               AND pq.answered_via = 'card'
               AND asking_turn.runtime_type = 'agentcore') AS question_resume_count`,
      [args.tenantId, item.threadId, turn.id],
    ),
    pool.query<{ participant_user_id: string }>(
      `SELECT participant_user_id::text
           FROM harness_participant_sessions
          WHERE tenant_id = $1 AND turn_id = $2 AND state = 'completed'`,
      [args.tenantId, turn.id],
    ),
  ]);
  const extra = extraRows[0] ?? {
    artifact_count: "0",
    attachment_count: "0",
    retained_memory_count: "0",
    question_resume_count: "0",
  };
  const semantic = containsEvidence(
    turn,
    toolRows,
    {
      artifactCount: number(extra.artifact_count),
      attachmentCount: number(extra.attachment_count),
      retainedMemoryCount: number(extra.retained_memory_count),
      questionResumeCount: number(extra.question_resume_count),
    },
    item.surface,
  );
  return {
    surface: item.surface,
    threadId: item.threadId,
    turnId: turn.id,
    runtimeType: turn.runtime_type,
    status: turn.status,
    finalized: turn.finalized,
    usagePresent: turn.usage_present,
    costRows: costRows.length,
    piCostRows: costRows.filter((row) => row.runtime_type === "pi").length,
    invocationSource: turn.invocation_source,
    completedOperations: terminalOperations(toolRows),
    principalIds: unique([
      ...participantRows.map((row) => row.participant_user_id),
      ...toolRows.map((row) => row.principal_id),
    ]),
    credentialOwners: unique(toolRows.map((row) => row.credential_owner_alias)),
    semanticEvidence: semantic.ok,
    semanticDetail: semantic.detail,
  };
}

async function loadRuntimeStats(
  pool: pg.Pool,
  args: Args,
): Promise<RuntimeWindowStats[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT tt.runtime_type,
            count(*) AS turns,
            count(*) FILTER (WHERE tt.status = 'succeeded') AS succeeded,
            count(*) FILTER (WHERE tt.status IN ('failed', 'cancelled')) AS failed,
            count(*) FILTER (WHERE tt.status = 'succeeded' AND tt.finalized_at IS NULL) AS missing_finalization,
            count(*) FILTER (WHERE tt.status = 'succeeded' AND tt.usage_json IS NULL) AS missing_usage,
            count(*) FILTER (WHERE tt.status = 'succeeded' AND NOT EXISTS (
              SELECT 1 FROM cost_events ce WHERE ce.tenant_id = tt.tenant_id AND ce.request_id = tt.id::text
            )) AS missing_cost,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (tt.finished_at - tt.started_at)) * 1000)
              FILTER (WHERE tt.finished_at IS NOT NULL AND tt.started_at IS NOT NULL) AS p50_duration_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (tt.finished_at - tt.started_at)) * 1000)
              FILTER (WHERE tt.finished_at IS NOT NULL AND tt.started_at IS NOT NULL) AS p95_duration_ms,
            COALESCE((SELECT sum(ce.amount_usd) FROM cost_events ce
              WHERE ce.tenant_id = $1 AND ce.runtime_type = tt.runtime_type
                AND ce.created_at >= $2 AND ce.created_at < $3), 0) AS total_cost_usd
       FROM thread_turns tt
      WHERE tt.tenant_id = $1 AND tt.runtime_type IN ('pi', 'agentcore')
        AND tt.created_at >= $2 AND tt.created_at < $3
      GROUP BY tt.runtime_type`,
    [args.tenantId, args.since, args.until],
  );
  return rows.map((row) => ({
    runtimeType: String(row.runtime_type) as RuntimeType,
    turns: number(row.turns),
    succeeded: number(row.succeeded),
    failed: number(row.failed),
    missingFinalization: number(row.missing_finalization),
    missingUsage: number(row.missing_usage),
    missingCost: number(row.missing_cost),
    p50DurationMs:
      row.p50_duration_ms == null ? null : number(row.p50_duration_ms),
    p95DurationMs:
      row.p95_duration_ms == null ? null : number(row.p95_duration_ms),
    totalCostUsd: number(row.total_cost_usd),
  }));
}

export async function loadEvalEvidence(
  pool: pg.Pool,
  args: Args,
): Promise<EvalEvidence[]> {
  return Promise.all(
    args.evals.map(async (item) => {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT id, status, total_tests, passed, failed, COALESCE(errored, 0) AS errored,
                profile_snapshot->>'runtimeType' AS actual_runtime, cost_partial
           FROM eval_runs
          WHERE tenant_id = $1 AND id = $2
            AND created_at >= $3 AND created_at < $4`,
        [args.tenantId, item.runId, args.since, args.until],
      );
      const row = rows[0] ?? {};
      return {
        id: item.runId,
        expectedRuntime: item.runtimeType,
        actualRuntime: row.actual_runtime ? String(row.actual_runtime) : null,
        status: row.status ? String(row.status) : "missing",
        totalTests: number(row.total_tests),
        passed: number(row.passed),
        failed: number(row.failed),
        errored: number(row.errored),
        costPartial:
          row.cost_partial == null ? null : Boolean(row.cost_partial),
      };
    }),
  );
}

async function scalar(
  pool: pg.Pool,
  sql: string,
  values: unknown[],
): Promise<number> {
  const { rows } = await pool.query<{ value: string }>(sql, values);
  return number(rows[0]?.value);
}

async function loadCanaryMatches(pool: pg.Pool, args: Args): Promise<number> {
  let matches = 0;
  for (const canary of args.canaries) {
    matches += await scalar(
      pool,
      `SELECT (
         (SELECT count(*) FROM thread_turns WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           AND strpos(CONCAT_WS(' ', error, system_prompt, usage_json::text, result_json::text, context_snapshot::text), $4) > 0) +
         (SELECT count(*) FROM harness_tool_execution_events WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           AND strpos(CONCAT_WS(' ', input_preview::text, output_preview::text, error_preview::text), $4) > 0) +
         (SELECT count(*) FROM cost_events WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           AND strpos(COALESCE(metadata::text, ''), $4) > 0) +
         (SELECT count(*) FROM artifacts WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           AND strpos(CONCAT_WS(' ', content, metadata::text), $4) > 0)
       )::text AS value`,
      [args.tenantId, args.since, args.until, canary],
    );
  }
  return matches;
}

export async function runCertification(args: Args) {
  const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL!));
  try {
    const [
      runtimeStats,
      surfaces,
      evals,
      mixedRuntimeThreads,
      piCostRows,
      orphanStarts,
      uncertain,
      driftFailures,
      canaryMatches,
    ] = await Promise.all([
      loadRuntimeStats(pool, args),
      Promise.all(
        args.cases.map((item) => loadSurfaceEvidence(pool, args, item)),
      ),
      loadEvalEvidence(pool, args),
      scalar(
        pool,
        `SELECT count(*)::text AS value FROM (
             SELECT thread_id FROM thread_turns
              WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
                AND runtime_type IN ('pi', 'agentcore')
              GROUP BY thread_id HAVING count(DISTINCT runtime_type) > 1
           ) mixed`,
        [args.tenantId, args.since, args.until],
      ),
      scalar(
        pool,
        `SELECT count(*)::text AS value FROM cost_events ce
             JOIN thread_turns tt ON tt.id::text = ce.request_id AND tt.tenant_id = ce.tenant_id
            WHERE tt.tenant_id = $1 AND tt.runtime_type = 'agentcore' AND ce.runtime_type = 'pi'
              AND tt.created_at >= $2 AND tt.created_at < $3`,
        [args.tenantId, args.since, args.until],
      ),
      scalar(
        pool,
        `SELECT count(*)::text AS value FROM harness_tool_execution_events started
            WHERE started.tenant_id = $1 AND started.event_type = 'started'
              AND started.created_at >= $2 AND started.created_at < $3
              AND NOT EXISTS (SELECT 1 FROM harness_tool_execution_events terminal
                WHERE terminal.tenant_id = started.tenant_id
                  AND terminal.idempotency_key = started.idempotency_key
                  AND terminal.event_type IN ('completed', 'failed', 'uncertain'))`,
        [args.tenantId, args.since, args.until],
      ),
      scalar(
        pool,
        `SELECT count(*)::text AS value FROM harness_tool_execution_events
            WHERE tenant_id = $1 AND event_type = 'uncertain'
              AND created_at >= $2 AND created_at < $3`,
        [args.tenantId, args.since, args.until],
      ),
      scalar(
        pool,
        `SELECT count(*)::text AS value FROM thread_turns
            WHERE tenant_id = $1 AND runtime_type = 'agentcore'
              AND created_at >= $2 AND created_at < $3
              AND (error_code = 'harness_enrollment_profile_drift' OR error ILIKE '%harness_enrollment_profile_drift%')`,
        [args.tenantId, args.since, args.until],
      ),
      loadCanaryMatches(pool, args),
    ]);

    const input: RetirementCertificationInput = {
      windowStart: args.since,
      windowEnd: args.until,
      minimumWindowHours: args.minimumHours,
      minimumSuccessRate: args.minimumSuccessRate,
      maximumP95DurationMs: args.maximumP95DurationMs,
      runtimeStats,
      surfaces,
      evals,
      mixedRuntimeThreads,
      piCostRowsOnAgentcoreTurns: piCostRows,
      orphanToolStarts: orphanStarts,
      uncertainToolOutcomes: uncertain,
      enrollmentDriftFailures: driftFailures,
      canaryCount: args.canaries.length,
      canaryMatches,
      rollbackRehearsed: args.rollbackRehearsed,
      capacityAdmitted: args.capacityAdmitted,
    };
    return { input, result: evaluateRetirementCertification(input) };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const output = await runCertification(args);
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(
      `AgentCore Harness retirement verdict: ${output.result.verdict}`,
    );
    console.log(`Soak window: ${output.result.windowHours.toFixed(2)} hours`);
    for (const row of output.result.checks) {
      console.log(
        `${row.status.toUpperCase().padEnd(10)} ${row.name}: ${row.detail}`,
      );
    }
  }
  if (output.result.verdict === "FAIL") process.exitCode = 1;
  else if (output.result.verdict === "IN_PROGRESS") process.exitCode = 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
