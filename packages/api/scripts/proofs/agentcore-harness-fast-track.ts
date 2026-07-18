#!/usr/bin/env tsx
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import {
  assertAllowedGatewayPolicyEvidence,
  parseGatewayApplicationLog,
  type GatewayPolicyDecisionEvidence,
} from "../../src/lib/harness/fast-track-evidence.js";

type CaseKind = "lastmile" | "twenty" | "plates" | "sandbox";

interface ProofCase {
  kind: CaseKind;
  threadId: string;
}

interface Args {
  cases: ProofCase[];
  region: string;
  logGroup: string;
  artifactBucket: string;
  expectedPolicy?: string;
  secretCanaries: string[];
  json: boolean;
}

interface TurnRow {
  id: string;
  tenant_id: string;
  thread_id: string;
  runtime_type: string | null;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  finalized_at: Date | null;
  usage_json: Record<string, unknown> | null;
  enrollment_status: string | null;
  session_strategy: string | null;
  harness_arn: string | null;
  qualifier: string | null;
  resolved_version: string | null;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface CaseResult {
  kind: CaseKind;
  threadId: string;
  turnId?: string;
  checks: Check[];
  gatewayDecisions: GatewayPolicyDecisionEvidence[];
}

const CASE_PATTERN = /^(lastmile|twenty|plates|sandbox)=([0-9a-f-]{36})$/i;

function usage(exitCode = 2): never {
  console.error(`Usage:
  DATABASE_URL=... pnpm --filter @thinkwork/api exec tsx \\
    scripts/proofs/agentcore-harness-fast-track.ts \\
    --case lastmile=<thread-uuid> --case twenty=<thread-uuid> \\
    --case plates=<thread-uuid> --case sandbox=<thread-uuid>

Environment:
  AWS_REGION                         default us-east-1
  AGENTCORE_GATEWAY_LOG_GROUP        required unless --log-group is supplied
  ARTIFACT_PAYLOADS_BUCKET           required for plates
  HARNESS_CERTIFICATION_CANARIES     comma-separated injected canaries; required for final U9 certification

The command exits non-zero for missing AgentCore provenance, managed Gateway
policy evidence, target/provider success, LLM/compute cost, durable plate
objects, Pi contamination, or a canary match.`);
  process.exit(exitCode);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const cases: ProofCase[] = [];
  let region = process.env.AWS_REGION || "us-east-1";
  let logGroup = process.env.AGENTCORE_GATEWAY_LOG_GROUP || "";
  let artifactBucket = process.env.ARTIFACT_PAYLOADS_BUCKET || "";
  let expectedPolicy = process.env.AGENTCORE_EXPECTED_POLICY || undefined;
  let json = false;
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--case") {
      const value = raw[++index] || "";
      const match = value.match(CASE_PATTERN);
      if (!match) usage();
      cases.push({
        kind: match[1]!.toLowerCase() as CaseKind,
        threadId: match[2]!.toLowerCase(),
      });
    } else if (arg === "--region") region = raw[++index] || region;
    else if (arg === "--log-group") logGroup = raw[++index] || "";
    else if (arg === "--artifact-bucket") {
      artifactBucket = raw[++index] || "";
    } else if (arg === "--expected-policy") {
      expectedPolicy = raw[++index] || undefined;
    } else if (arg === "--json") json = true;
    else usage();
  }
  if (!process.env.DATABASE_URL || !logGroup || cases.length === 0) usage();
  const kinds = new Set(cases.map((proofCase) => proofCase.kind));
  if (kinds.size !== cases.length) {
    throw new Error("Each fast-track case kind may be supplied only once");
  }
  const secretCanaries = (process.env.HARNESS_CERTIFICATION_CANARIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    cases,
    region,
    logGroup,
    artifactBucket,
    expectedPolicy,
    secretCanaries,
    json,
  };
}

function check(checks: Check[], name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function terminalToolPairs(rows: Array<Record<string, unknown>>) {
  const started = new Map<string, Record<string, unknown>>();
  const pairs: Array<{
    start: Record<string, unknown>;
    terminal: Record<string, unknown>;
  }> = [];
  for (const row of rows) {
    const key = String(row.idempotency_key ?? "");
    if (row.event_type === "started") started.set(key, row);
    else if (started.has(key)) pairs.push({ start: started.get(key)!, terminal: row });
  }
  return pairs;
}

async function gatewayRecordsForTurn(input: {
  client: CloudWatchLogsClient;
  logGroup: string;
  turn: TurnRow;
}) {
  const startTime = input.turn.started_at.getTime() - 60_000;
  const endTime =
    (input.turn.finished_at ?? new Date()).getTime() + 60_000;
  const messages: string[] = [];
  for (const filterPattern of [
    `"tw-harness-turn-${input.turn.id}"`,
    '"Policy evaluation completed"',
  ]) {
    let nextToken: string | undefined;
    do {
      const response = await input.client.send(
        new FilterLogEventsCommand({
          logGroupName: input.logGroup,
          startTime,
          endTime,
          filterPattern,
          nextToken,
        }),
      );
      messages.push(
        ...(response.events ?? [])
          .map((event) => event.message)
          .filter((message): message is string => Boolean(message)),
      );
      nextToken = response.nextToken;
    } while (nextToken);
  }
  return [...new Set(messages)].map(parseGatewayApplicationLog);
}

async function certifyCase(input: {
  proofCase: ProofCase;
  args: Args;
  pool: pg.Pool;
  logs: CloudWatchLogsClient;
  s3: S3Client;
}): Promise<CaseResult> {
  const checks: Check[] = [];
  const { rows: turns } = await input.pool.query<TurnRow>(
    `SELECT tt.id, tt.tenant_id, tt.thread_id, tt.runtime_type, tt.status,
            tt.started_at, tt.finished_at, tt.finalized_at, tt.usage_json,
            he.status AS enrollment_status, he.session_strategy,
            he.harness_arn, he.qualifier, he.resolved_version
       FROM thread_turns tt
       LEFT JOIN harness_managed_thread_enrollments he
         ON he.tenant_id = tt.tenant_id AND he.thread_id = tt.thread_id
      WHERE tt.thread_id = $1
      ORDER BY tt.created_at DESC
      LIMIT 1`,
    [input.proofCase.threadId],
  );
  const turn = turns[0];
  if (!turn) {
    return {
      kind: input.proofCase.kind,
      threadId: input.proofCase.threadId,
      checks: [{ name: "turn", ok: false, detail: "No turn found" }],
      gatewayDecisions: [],
    };
  }
  check(checks, "runtime", turn.runtime_type === "agentcore", String(turn.runtime_type));
  check(
    checks,
    "turn_terminal",
    turn.status === "succeeded" && Boolean(turn.finished_at && turn.finalized_at),
    `status=${turn.status} finalized=${Boolean(turn.finalized_at)}`,
  );
  check(
    checks,
    "enrollment",
    turn.enrollment_status === "active" && turn.session_strategy === "fresh",
    `status=${turn.enrollment_status} strategy=${turn.session_strategy}`,
  );
  check(
    checks,
    "harness_identity",
    Boolean(turn.harness_arn && turn.qualifier && turn.resolved_version),
    `${turn.harness_arn ?? "missing"} qualifier=${turn.qualifier ?? "missing"} version=${turn.resolved_version ?? "missing"}`,
  );

  const { rows: toolRows } = await input.pool.query<Record<string, unknown>>(
    `SELECT idempotency_key, event_type, operation, principal_type,
            principal_id, policy_revision, credential_owner_alias,
            input_preview, output_preview, error_preview, duration_ms
       FROM harness_tool_execution_events
      WHERE tenant_id = $1 AND thread_id = $2 AND turn_id = $3
      ORDER BY id`,
    [turn.tenant_id, turn.thread_id, turn.id],
  );
  const pairs = terminalToolPairs(toolRows);
  const completed = pairs.filter(({ terminal }) => terminal.event_type === "completed");
  const connector =
    input.proofCase.kind === "lastmile"
      ? "lastmile-data-catalog"
      : input.proofCase.kind === "twenty" || input.proofCase.kind === "plates"
        ? "twenty--crm"
        : null;
  const expectedTool =
    input.proofCase.kind === "sandbox"
      ? completed.find(({ start }) => start.operation === "sandbox.execute_code")
      : completed.find(({ start }) => {
          const preview = asRecord(start.input_preview);
          return start.operation === "mcp.tools.call" && preview.connector === connector;
        });
  check(
    checks,
    "target_terminal",
    Boolean(expectedTool),
    expectedTool
      ? `${String(expectedTool.start.operation)} completed`
      : `No completed ${connector ?? "sandbox"} target pair`,
  );
  if (input.proofCase.kind === "lastmile" && expectedTool) {
    check(
      checks,
      "service_credential_owner",
      typeof expectedTool.start.credential_owner_alias === "string" &&
        Boolean(expectedTool.start.credential_owner_alias),
      String(expectedTool.start.credential_owner_alias ?? "missing"),
    );
  }

  const { rows: costs } = await input.pool.query<Record<string, unknown>>(
    `SELECT event_type, runtime_type, amount_usd, duration_ms, provider, model
       FROM cost_events WHERE request_id = $1 ORDER BY event_type`,
    [turn.id],
  );
  const costTypes = new Set(
    costs
      .filter((row) => row.runtime_type === "agentcore")
      .map((row) => String(row.event_type)),
  );
  check(
    checks,
    "cost_components",
    costTypes.has("llm") && costTypes.has("agentcore_compute"),
    [...costTypes].join(",") || "none",
  );
  check(
    checks,
    "zero_pi_cost",
    !costs.some((row) => row.runtime_type === "pi"),
    `${costs.filter((row) => row.runtime_type === "pi").length} Pi rows`,
  );

  let gatewayDecisions: GatewayPolicyDecisionEvidence[] = [];
  try {
    const records = await gatewayRecordsForTurn({
      client: input.logs,
      logGroup: input.args.logGroup,
      turn,
    });
    gatewayDecisions = assertAllowedGatewayPolicyEvidence({
      records,
      turnId: turn.id,
      expectedPolicyArnOrId: input.args.expectedPolicy,
    });
    check(
      checks,
      "gateway_policy",
      true,
      `${gatewayDecisions.length} managed ALLOW decision(s)`,
    );
  } catch (error) {
    check(
      checks,
      "gateway_policy",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const evidenceValues: unknown[] = [turn, toolRows, costs, gatewayDecisions];
  if (input.proofCase.kind === "plates") {
    const { rows: artifacts } = await input.pool.query<Record<string, unknown>>(
      `SELECT id, tenant_id, type, status, s3_key, source_message_id, metadata
         FROM artifacts WHERE tenant_id = $1 AND thread_id = $2
        ORDER BY created_at DESC`,
      [turn.tenant_id, turn.thread_id],
    );
    evidenceValues.push(artifacts);
    const artifact = artifacts.find((row) => {
      const metadata = asRecord(row.metadata);
      return (
        row.type === "sales-rep-review" &&
        metadata.genre === "sales-rep-review" &&
        typeof row.s3_key === "string" &&
        row.s3_key.endsWith("/content.md")
      );
    });
    check(
      checks,
      "plate_artifact",
      Boolean(artifact),
      artifact ? String(artifact.id) : "No registered sales-rep-review artifact",
    );
    if (artifact && input.args.artifactBucket) {
      const contentKey = String(artifact.s3_key);
      const renderKey = contentKey.replace(/\/content\.md$/, "/render.html");
      try {
        const [content, render] = await Promise.all([
          input.s3.send(
            new HeadObjectCommand({
              Bucket: input.args.artifactBucket,
              Key: contentKey,
            }),
          ),
          input.s3.send(
            new HeadObjectCommand({
              Bucket: input.args.artifactBucket,
              Key: renderKey,
            }),
          ),
        ]);
        check(
          checks,
          "plate_objects",
          Number(content.ContentLength) > 0 && Number(render.ContentLength) > 0,
          `content.md=${content.ContentLength}B render.html=${render.ContentLength}B`,
        );
      } catch (error) {
        check(
          checks,
          "plate_objects",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      check(
        checks,
        "plate_objects",
        false,
        "ARTIFACT_PAYLOADS_BUCKET is required",
      );
    }
  }

  if (input.args.secretCanaries.length === 0) {
    check(
      checks,
      "secret_canary_scan",
      false,
      "HARNESS_CERTIFICATION_CANARIES is required for final certification",
    );
  } else {
    const serialized = JSON.stringify(evidenceValues);
    const matches = input.args.secretCanaries.filter((value) =>
      serialized.includes(value),
    );
    check(
      checks,
      "secret_canary_scan",
      matches.length === 0,
      matches.length === 0 ? "zero matches" : `${matches.length} canary match(es)`,
    );
  }

  return {
    kind: input.proofCase.kind,
    threadId: input.proofCase.threadId,
    turnId: turn.id,
    checks,
    gatewayDecisions,
  };
}

async function main() {
  const args = parseArgs();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const logs = new CloudWatchLogsClient({ region: args.region });
  const s3 = new S3Client({ region: args.region });
  try {
    const results: CaseResult[] = [];
    for (const proofCase of args.cases) {
      results.push(await certifyCase({ proofCase, args, pool, logs, s3 }));
    }
    const ok = results.every((result) => result.checks.every((item) => item.ok));
    if (args.json) console.log(JSON.stringify({ ok, results }, null, 2));
    else {
      for (const result of results) {
        console.log(`\n${result.kind.toUpperCase()} ${result.threadId}`);
        if (result.turnId) console.log(`  turn ${result.turnId}`);
        for (const item of result.checks) {
          console.log(`  ${item.ok ? "PASS" : "FAIL"} ${item.name}: ${item.detail}`);
        }
      }
      console.log(`\nFAST-TRACK VERDICT: ${ok ? "PASS" : "FAIL"}`);
    }
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
    logs.destroy();
    s3.destroy();
  }
}

await main();
