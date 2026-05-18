/**
 * `thinkwork performance ...` — agent invocation counts, error rates, p95.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError } from "../ui.js";
import { resolveTenantContext, type TenantCliOptions } from "../lib/resolve-tenant-id.js";

const AgentPerformanceDoc = graphql(`
  query CliAgentPerformance($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    agentPerformance(tenantId: $tenantId, from: $from, to: $to) {
      agentId
      agentName
      invocationCount
      errorCount
      avgDurationMs
      p95DurationMs
      totalInputTokens
      totalOutputTokens
      totalCostUsd
    }
  }
`);

const SingleAgentPerformanceDoc = graphql(`
  query CliSingleAgentPerformance($agentId: ID!, $tenantId: ID!) {
    singleAgentPerformance(agentId: $agentId, tenantId: $tenantId) {
      agentId
      agentName
      invocationCount
      errorCount
      avgDurationMs
      p95DurationMs
      totalInputTokens
      totalOutputTokens
      totalCostUsd
    }
  }
`);

interface RangeOptions extends TenantCliOptions {
  from?: string;
  to?: string;
}

async function runPerfAgents(opts: RangeOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, AgentPerformanceDoc, {
    tenantId: ctx.tenantId,
    from: opts.from ?? null,
    to: opts.to ?? null,
  });
  const items = data.agentPerformance ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((p) => ({
      agent: p.agentName,
      invocations: p.invocationCount.toLocaleString(),
      errors: p.errorCount.toLocaleString(),
      avgMs: p.avgDurationMs.toFixed(0),
      p95Ms: p.p95DurationMs.toFixed(0),
      cost: `$${p.totalCostUsd.toFixed(2)}`,
    })),
    [
      { key: "agent", header: "AGENT" },
      { key: "invocations", header: "INVOCATIONS" },
      { key: "errors", header: "ERRORS" },
      { key: "avgMs", header: "AVG (ms)" },
      { key: "p95Ms", header: "P95 (ms)" },
      { key: "cost", header: "COST" },
    ],
  );
}

async function runPerfAgent(agentId: string, opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, SingleAgentPerformanceDoc, {
    agentId,
    tenantId: ctx.tenantId,
  });
  const p = data.singleAgentPerformance;
  if (!p) {
    printError(`No performance data for agent ${agentId}.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(p);
    return;
  }
  printKeyValue([
    ["Agent", p.agentName],
    ["Invocations", p.invocationCount.toLocaleString()],
    ["Errors", p.errorCount.toLocaleString()],
    ["Avg duration (ms)", p.avgDurationMs.toFixed(0)],
    ["P95 duration (ms)", p.p95DurationMs.toFixed(0)],
    ["Input tokens", p.totalInputTokens.toLocaleString()],
    ["Output tokens", p.totalOutputTokens.toLocaleString()],
    ["Total cost", `$${p.totalCostUsd.toFixed(2)}`],
  ]);
}

export function registerPerformanceCommand(program: Command): void {
  const perf = program
    .command("performance")
    .alias("perf")
    .description("Agent invocation counts, error rates, and latency p95.");

  perf
    .command("agents")
    .description("Performance metrics for every agent in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>", "Range start (ISO-8601)")
    .option("--to <iso>", "Range end (ISO-8601)")
    .action(runPerfAgents);

  perf
    .command("agent <id>")
    .description("Performance metrics for one agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runPerfAgent);
}
