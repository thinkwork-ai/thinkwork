#!/usr/bin/env tsx
/**
 * verify-thread-traces — end-to-end check for the ThreadTraces UI surface.
 *
 * Purpose (plan reference: U1 / U8 / R11-R12 of
 * docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md):
 *
 *   The admin thread detail page renders an "Open in X-Ray" deeplink from
 *   `cost_events.trace_id`. It was never empirically verified that this
 *   trace_id value is actually a real AWS X-Ray segment ID — it may be an
 *   OpenTelemetry-shaped correlation ID that happens to look hex-like but
 *   opens an empty X-Ray console page. This script is the authoritative
 *   source of truth for whether U8 ships the keep-path or remove-path.
 *
 * What it does:
 *   1. Reads a thread's TraceEvent rows via the GraphQL `threadTraces` query
 *      on the deployed stack (requires operator-provided auth).
 *   2. For each TraceEvent.traceId, calls `aws xray batch-get-traces` and
 *      reports hit/miss.
 *   3. Prints a summary + the CloudWatch X-Ray console URL shape the admin
 *      UI will construct.
 *
 * Exit codes:
 *   0 — at least one trace_id resolved to a real X-Ray trace with segments
 *       → U8 keep-path is safe; R12 passes; ship the "Open in X-Ray" link.
 *   1 — thread returned traces but none resolved to X-Ray (or threadTraces
 *       returned empty after the poll window)
 *       → U8 remove-path; drop ThreadTraces and the deeplink.
 *   2 — configuration / network / auth error; inconclusive; re-run after
 *       fixing env.
 *
 * Usage:
 *   THINKWORK_GRAPHQL_URL=... \
 *   THINKWORK_ID_TOKEN=... \
 *   THINKWORK_THREAD_ID=<uuid> \
 *   THINKWORK_TENANT_ID=<uuid> \
 *   AWS_REGION=us-east-1 \
 *   pnpm tsx scripts/verify-thread-traces.ts
 *
 *   # Or via flags:
 *   pnpm tsx scripts/verify-thread-traces.ts \
 *     --graphql-url https://api-dev.thinkwork.ai/graphql \
 *     --id-token "$(cat ~/.thinkwork/config.json | jq -r '.stages.dev.idToken')" \
 *     --thread-id <uuid> --tenant-id <uuid> --region us-east-1
 *
 * Prerequisites:
 *   - A deployed dev stack (thinkwork deploy --stage dev) with at least one
 *     thread that has produced Bedrock activity recently (so cost_events has
 *     rows with non-null trace_id).
 *   - AWS CLI v2 installed on PATH + credentials with `xray:BatchGetTraces`
 *     (default profile or AWS_PROFILE). The script shells out to
 *     `aws xray batch-get-traces` via execFileSync — matches the pattern in
 *     scripts/cloudflare-sync-mcp.ts and avoids adding an SDK dep.
 *   - A Cognito ID token for a tenant-admin user (run `thinkwork login
 *     --stage dev` and read from ~/.thinkwork/config.json, or paste directly
 *     via THINKWORK_ID_TOKEN).
 *
 * Re-runnable as a regression check after every deploy touching the
 * observability path.
 */

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  graphqlUrl: string;
  idToken: string;
  threadId: string;
  tenantId: string;
  region: string;
  pollSeconds: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    graphqlUrl: process.env.THINKWORK_GRAPHQL_URL ?? "",
    idToken: process.env.THINKWORK_ID_TOKEN ?? "",
    threadId: process.env.THINKWORK_THREAD_ID ?? "",
    tenantId: process.env.THINKWORK_TENANT_ID ?? "",
    region: process.env.AWS_REGION ?? "us-east-1",
    pollSeconds: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--graphql-url") {
      args.graphqlUrl = value ?? "";
      i++;
    } else if (flag === "--id-token") {
      args.idToken = value ?? "";
      i++;
    } else if (flag === "--thread-id") {
      args.threadId = value ?? "";
      i++;
    } else if (flag === "--tenant-id") {
      args.tenantId = value ?? "";
      i++;
    } else if (flag === "--region") {
      args.region = value ?? "us-east-1";
      i++;
    } else if (flag === "--poll-seconds") {
      args.pollSeconds = Number.parseInt(value ?? "30", 10);
      i++;
    }
  }
  return args;
}

function requireArgs(args: Args): void {
  const missing: string[] = [];
  if (!args.graphqlUrl) missing.push("--graphql-url / THINKWORK_GRAPHQL_URL");
  if (!args.idToken) missing.push("--id-token / THINKWORK_ID_TOKEN");
  if (!args.threadId) missing.push("--thread-id / THINKWORK_THREAD_ID");
  if (!args.tenantId) missing.push("--tenant-id / THINKWORK_TENANT_ID");
  if (missing.length > 0) {
    console.error(`Missing required args: ${missing.join(", ")}`);
    console.error("Run with -h to see usage.");
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

interface TraceEvent {
  traceId: string;
  agentName: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
}

const THREAD_TRACES_QUERY = /* GraphQL */ `
  query VerifyThreadTraces($threadId: ID!, $tenantId: ID!) {
    threadTraces(threadId: $threadId, tenantId: $tenantId) {
      traceId
      agentName
      model
      inputTokens
      outputTokens
      durationMs
      costUsd
      createdAt
    }
  }
`;

async function fetchThreadTraces(args: Args): Promise<TraceEvent[]> {
  const deadline = Date.now() + args.pollSeconds * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const response = await fetch(args.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.idToken}`,
      },
      body: JSON.stringify({
        query: THREAD_TRACES_QUERY,
        variables: { threadId: args.threadId, tenantId: args.tenantId },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `GraphQL HTTP ${response.status} ${response.statusText}: ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      data?: { threadTraces?: TraceEvent[] };
      errors?: Array<{ message: string }>;
    };
    if (body.errors && body.errors.length > 0) {
      throw new Error(
        `GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const traces = body.data?.threadTraces ?? [];
    if (traces.length > 0) {
      console.log(
        `[poll ${attempt}] threadTraces returned ${traces.length} row(s); proceeding to X-Ray.`,
      );
      return traces;
    }
    console.log(
      `[poll ${attempt}] threadTraces empty; waiting 3s (deadline in ${Math.max(
        0,
        Math.round((deadline - Date.now()) / 1000),
      )}s)`,
    );
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return [];
}

// ---------------------------------------------------------------------------
// X-Ray verification
// ---------------------------------------------------------------------------

interface XRayVerdict {
  traceId: string;
  hit: boolean;
  segmentCount: number;
  consoleUrl: string;
  reason?: string;
}

interface XRayBatchGetTracesResponse {
  Traces?: Array<{ Id?: string; Segments?: Array<{ Id?: string }> }>;
  UnprocessedTraceIds?: string[];
}

function verifyTraceInXRay(traceId: string, region: string): XRayVerdict {
  const consoleUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#xray:traces/${encodeURIComponent(
    traceId,
  )}`;
  try {
    const raw = execFileSync(
      "aws",
      [
        "xray",
        "batch-get-traces",
        "--region",
        region,
        "--trace-ids",
        traceId,
        "--output",
        "json",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as XRayBatchGetTracesResponse;
    const traces = parsed.Traces ?? [];
    if (traces.length === 0) {
      return {
        traceId,
        hit: false,
        segmentCount: 0,
        consoleUrl,
        reason: "X-Ray returned no Traces for this id",
      };
    }
    const segments = traces[0]?.Segments ?? [];
    return {
      traceId,
      hit: segments.length > 0,
      segmentCount: segments.length,
      consoleUrl,
      reason:
        segments.length > 0
          ? undefined
          : "X-Ray returned a trace with zero segments",
    };
  } catch (error) {
    return {
      traceId,
      hit: false,
      segmentCount: 0,
      consoleUrl,
      reason: `aws xray batch-get-traces failed: ${(error as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(
      "Usage: pnpm tsx scripts/verify-thread-traces.ts [flags]\n\nSee header comment for full usage and exit codes.",
    );
    process.exit(0);
  }
  requireArgs(args);

  console.log(`== verify-thread-traces ==`);
  console.log(`  graphql-url:  ${args.graphqlUrl}`);
  console.log(`  thread-id:    ${args.threadId}`);
  console.log(`  tenant-id:    ${args.tenantId}`);
  console.log(`  region:       ${args.region}`);
  console.log(`  poll-seconds: ${args.pollSeconds}`);
  console.log("");

  let traces: TraceEvent[];
  try {
    traces = await fetchThreadTraces(args);
  } catch (error) {
    console.error(`GraphQL fetch failed: ${(error as Error).message}`);
    process.exit(2);
  }

  if (traces.length === 0) {
    console.error(
      `\nNo TraceEvent rows returned for thread ${args.threadId} within ${args.pollSeconds}s.\n` +
        `  Either the thread has no Bedrock activity, or cost_events is not being populated.\n` +
        `  Cannot verify X-Ray linkage. Re-run against a thread with recent activity.\n`,
    );
    process.exit(1);
  }

  console.log(`\n-- TraceEvent rows (sample) --`);
  for (const t of traces.slice(0, 5)) {
    console.log(
      `  traceId=${t.traceId}  model=${t.model ?? "?"}  tokens=${
        t.inputTokens ?? 0
      }→${t.outputTokens ?? 0}  cost=$${(t.costUsd ?? 0).toFixed(4)}  at=${
        t.createdAt
      }`,
    );
  }
  if (traces.length > 5) console.log(`  ... and ${traces.length - 5} more`);

  const verdicts: XRayVerdict[] = traces.map((t) =>
    verifyTraceInXRay(t.traceId, args.region),
  );

  console.log(`\n-- X-Ray verification --`);
  const hits = verdicts.filter((v) => v.hit);
  const misses = verdicts.filter((v) => !v.hit);
  for (const v of verdicts) {
    const status = v.hit
      ? `HIT (${v.segmentCount} segments)`
      : `MISS (${v.reason ?? "unknown"})`;
    console.log(`  [${status}] ${v.traceId}`);
    console.log(`    ${v.consoleUrl}`);
  }

  console.log(`\n-- Summary --`);
  console.log(`  total TraceEvents: ${traces.length}`);
  console.log(`  X-Ray hits:        ${hits.length}`);
  console.log(`  X-Ray misses:      ${misses.length}`);

  if (hits.length > 0) {
    console.log(
      `\n  VERDICT: U8 keep-path. At least one cost_events.trace_id opens a real X-Ray trace.`,
    );
    console.log(`  Ship the "Open in X-Ray" deeplink in U6.`);
    process.exit(0);
  }

  console.log(
    `\n  VERDICT: U8 remove-path. No trace_id opened a real X-Ray trace.`,
  );
  console.log(
    `  Drop ThreadTraces component, ThreadTracesQuery, and the TraceEvent surface on thread detail (per R12).`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(
    `verify-thread-traces failed: ${(error as Error).stack ?? error}`,
  );
  process.exit(2);
});
