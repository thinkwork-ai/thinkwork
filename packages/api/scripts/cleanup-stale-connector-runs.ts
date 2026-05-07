#!/usr/bin/env tsx
/**
 * Cleanup stale historical connector runs from early Symphony checkpoint work.
 *
 * Dry-run is the default. Use --apply only after reviewing the candidate list.
 *
 * Usage:
 *   pnpm -C packages/api exec tsx scripts/cleanup-stale-connector-runs.ts --tenant <uuid>
 *   pnpm -C packages/api exec tsx scripts/cleanup-stale-connector-runs.ts --tenant <uuid> --apply
 *   pnpm -C packages/api exec tsx scripts/cleanup-stale-connector-runs.ts --connector <uuid> --older-than-hours 12 --apply
 */

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const ACTIVE_EXECUTION_STATES = [
  "pending",
  "dispatching",
  "invoking",
  "recording_result",
];

type Options = {
  apply: boolean;
  tenantId: string | null;
  connectorId: string | null;
  connectorType: string;
  externalRefPrefix: string | null;
  olderThanHours: number;
  limit: number;
};

type CandidateRow = {
  execution_id: string;
  connector_id: string;
  tenant_id: string;
  external_ref: string;
  execution_state: string;
  task_id: string | null;
  task_status: string | null;
  delegation_id: string | null;
  delegation_status: string | null;
  turn_id: string | null;
  turn_status: string | null;
  stale_reason: string;
  run_age: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    apply: false,
    tenantId: null,
    connectorId: null,
    connectorType: "linear_tracker",
    externalRefPrefix: null,
    olderThanHours: 4,
    limit: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        opts.apply = true;
        break;
      case "--tenant":
        opts.tenantId = requireValue(argv, ++i, arg);
        break;
      case "--connector":
        opts.connectorId = requireValue(argv, ++i, arg);
        break;
      case "--connector-type":
        opts.connectorType = requireValue(argv, ++i, arg);
        break;
      case "--external-ref-prefix":
        opts.externalRefPrefix = requireValue(argv, ++i, arg);
        break;
      case "--older-than-hours":
        opts.olderThanHours = parsePositiveNumber(
          requireValue(argv, ++i, arg),
          arg,
        );
        break;
      case "--limit":
        opts.limit = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.tenantId) validateUuid(opts.tenantId, "--tenant");
  if (opts.connectorId) validateUuid(opts.connectorId, "--connector");
  if (opts.apply && !opts.tenantId && !opts.connectorId) {
    throw new Error("--apply requires --tenant or --connector scope");
  }

  return opts;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function validateUuid(value: string, flag: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${flag} must be a UUID`);
  }
}

function printHelp(): void {
  console.log(`cleanup-stale-connector-runs.ts

Dry-run historical stale Symphony connector lifecycle cleanup.

Options:
  --tenant <uuid>                 Limit to one tenant
  --connector <uuid>              Limit to one connector
  --connector-type <type>         Connector type, default linear_tracker
  --external-ref-prefix <prefix>  Limit to refs like TECH-
  --older-than-hours <n>          Candidate age cutoff, default 4
  --limit <n>                     Max candidate rows, default 100
  --apply                         Apply cleanup; requires --tenant or --connector
  --help                          Show this help
`);
}

function candidateConditions(opts: Options): SQL[] {
  const conditions: SQL[] = [
    sql`c.type = ${opts.connectorType}`,
    sql`c.dispatch_target_type = 'computer'`,
    sql`COALESCE(ce.started_at, ce.created_at) < now() - (${String(
      opts.olderThanHours,
    )} || ' hours')::interval`,
    sql`(
      ce.current_state IN (${activeExecutionStateSqlList()})
      OR (
        ce.current_state = 'terminal'
        AND (
          ce.outcome_payload->>'computerTaskId' IS NULL
          OR ct.id IS NULL
          OR ct.status <> 'completed'
          OR cd.id IS NULL
          OR cd.status <> 'completed'
          OR tt.id IS NULL
          OR tt.status <> 'succeeded'
        )
      )
    )`,
  ];

  if (opts.tenantId) conditions.push(sql`ce.tenant_id = ${opts.tenantId}`);
  if (opts.connectorId) {
    conditions.push(sql`ce.connector_id = ${opts.connectorId}`);
  }
  if (opts.externalRefPrefix) {
    conditions.push(sql`ce.external_ref LIKE ${`${opts.externalRefPrefix}%`}`);
  }

  return conditions;
}

function activeExecutionStateSqlList(): SQL {
  return sql.join(
    ACTIVE_EXECUTION_STATES.map((state) => sql`${state}`),
    sql`, `,
  );
}

function candidatesCte(opts: Options): SQL {
  return sql`
    SELECT
      ce.id AS execution_id,
      ce.connector_id,
      ce.tenant_id,
      ce.external_ref,
      ce.current_state AS execution_state,
      ct.id AS task_id,
      ct.status AS task_status,
      cd.id AS delegation_id,
      cd.status AS delegation_status,
      tt.id AS turn_id,
      tt.status AS turn_status,
      CASE
        WHEN ce.current_state IN (${activeExecutionStateSqlList()}) THEN 'stale_active_execution'
        WHEN ce.outcome_payload->>'computerTaskId' IS NULL THEN 'missing_computer_task_link'
        WHEN ct.id IS NULL THEN 'missing_computer_task'
        WHEN ct.status <> 'completed' THEN 'incomplete_computer_task'
        WHEN cd.id IS NULL THEN 'missing_delegation'
        WHEN cd.status <> 'completed' THEN 'incomplete_delegation'
        WHEN tt.id IS NULL THEN 'missing_thread_turn'
        WHEN tt.status <> 'succeeded' THEN 'incomplete_thread_turn'
        ELSE 'stale_connector_lifecycle'
      END AS stale_reason,
      age(now(), COALESCE(ce.started_at, ce.created_at))::text AS run_age
    FROM connector_executions ce
    JOIN connectors c
      ON c.id = ce.connector_id
      AND c.tenant_id = ce.tenant_id
    LEFT JOIN computer_tasks ct
      ON ct.tenant_id = ce.tenant_id
      AND ct.id::text = ce.outcome_payload->>'computerTaskId'
    LEFT JOIN LATERAL (
      SELECT d.*
      FROM computer_delegations d
      WHERE d.tenant_id = ce.tenant_id
        AND d.task_id = ct.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) cd ON true
    LEFT JOIN thread_turns tt
      ON tt.tenant_id = ce.tenant_id
      AND tt.id::text = COALESCE(
        cd.result->>'threadTurnId',
        cd.output_artifacts->>'threadTurnId'
      )
    WHERE ${sql.join(candidateConditions(opts), sql` AND `)}
    ORDER BY COALESCE(ce.started_at, ce.created_at) DESC
    LIMIT ${opts.limit}
  `;
}

async function listCandidates(opts: Options): Promise<CandidateRow[]> {
  const db = getDb();
  const result = await db.execute<CandidateRow>(sql`${candidatesCte(opts)}`);
  return result.rows ?? [];
}

async function applyCleanup(opts: Options): Promise<void> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH candidates AS (${candidatesCte(opts)}),
    updated_turns AS (
      UPDATE thread_turns tt
      SET
        status = 'cancelled',
        finished_at = COALESCE(tt.finished_at, now()),
        error = COALESCE(tt.error, 'stale connector lifecycle cleanup'),
        error_code = COALESCE(tt.error_code, 'stale_connector_cleanup')
      FROM candidates c
      WHERE tt.id = c.turn_id
        AND tt.status IN ('queued', 'running')
      RETURNING tt.id
    ),
    updated_delegations AS (
      UPDATE computer_delegations cd
      SET
        status = 'cancelled',
        completed_at = COALESCE(cd.completed_at, now()),
        error = COALESCE(cd.error, '{}'::jsonb) || jsonb_build_object(
          'cleanup',
          jsonb_build_object(
            'reason', 'stale_connector_lifecycle',
            'source', 'cleanup-stale-connector-runs',
            'appliedAt', now(),
            'olderThanHours', ${opts.olderThanHours}
          )
        )
      FROM candidates c
      WHERE cd.id = c.delegation_id
        AND cd.status IN ('pending', 'running')
      RETURNING cd.id
    ),
    updated_tasks AS (
      UPDATE computer_tasks ct
      SET
        status = 'cancelled',
        completed_at = COALESCE(ct.completed_at, now()),
        updated_at = now(),
        error = COALESCE(ct.error, '{}'::jsonb) || jsonb_build_object(
          'cleanup',
          jsonb_build_object(
            'reason', 'stale_connector_lifecycle',
            'source', 'cleanup-stale-connector-runs',
            'appliedAt', now(),
            'olderThanHours', ${opts.olderThanHours}
          )
        )
      FROM candidates c
      WHERE ct.id = c.task_id
        AND ct.status IN ('pending', 'running')
      RETURNING ct.id
    ),
    updated_executions AS (
      UPDATE connector_executions ce
      SET
        current_state = 'cancelled',
        finished_at = COALESCE(ce.finished_at, now()),
        error_class = 'stale_connector_cleanup',
        outcome_payload = COALESCE(ce.outcome_payload, '{}'::jsonb) || jsonb_build_object(
          'cleanup',
          jsonb_build_object(
            'reason', c.stale_reason,
            'source', 'cleanup-stale-connector-runs',
            'appliedAt', now(),
            'olderThanHours', ${opts.olderThanHours},
            'previousState', ce.current_state,
            'computerTaskStatus', c.task_status,
            'delegationStatus', c.delegation_status,
            'threadTurnStatus', c.turn_status
          )
        )
      FROM candidates c
      WHERE ce.id = c.execution_id
      RETURNING ce.id
    )
    SELECT
      (SELECT count(*)::int FROM updated_executions) AS executions,
      (SELECT count(*)::int FROM updated_tasks) AS tasks,
      (SELECT count(*)::int FROM updated_delegations) AS delegations,
      (SELECT count(*)::int FROM updated_turns) AS turns
  `);

  const [counts] =
    (result.rows as
      | Array<{
          executions: number;
          tasks: number;
          delegations: number;
          turns: number;
        }>
      | undefined) ?? [];
  console.log(
    `Applied cleanup: executions=${counts?.executions ?? 0} tasks=${counts?.tasks ?? 0} delegations=${counts?.delegations ?? 0} turns=${counts?.turns ?? 0}`,
  );
}

function printCandidates(rows: CandidateRow[]): void {
  if (rows.length === 0) {
    console.log("No stale connector run candidates found.");
    return;
  }

  console.log(`Found ${rows.length} stale connector run candidate(s):`);
  for (const row of rows) {
    console.log(
      [
        `execution=${row.execution_id}`,
        `ref=${row.external_ref}`,
        `state=${row.execution_state}`,
        `task=${row.task_status ?? "missing"}`,
        `delegation=${row.delegation_status ?? "missing"}`,
        `turn=${row.turn_status ?? "missing"}`,
        `reason=${row.stale_reason}`,
        `age=${row.run_age}`,
      ].join(" "),
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const candidates = await listCandidates(opts);
  printCandidates(candidates);

  if (!opts.apply) {
    console.log(
      "Dry run only. Re-run with --apply to mark these rows cancelled.",
    );
    return;
  }

  if (candidates.length === 0) return;
  await applyCleanup(opts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cleanup-stale-connector-runs] failed", err);
    process.exit(1);
  });
