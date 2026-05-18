/**
 * `thinkwork cost ...` — spend summaries (tenant, per-agent, per-model, series).
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../lib/output.js";
import { resolveTenantContext, type TenantCliOptions } from "../lib/resolve-tenant-id.js";

const CostSummaryDoc = graphql(`
  query CliCostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costSummary(tenantId: $tenantId, from: $from, to: $to) {
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      evalUsd
      totalInputTokens
      totalOutputTokens
      eventCount
    }
  }
`);

const CostByAgentDoc = graphql(`
  query CliCostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costByAgent(tenantId: $tenantId, from: $from, to: $to) {
      agentId
      agentName
      totalUsd
      eventCount
    }
  }
`);

const CostByModelDoc = graphql(`
  query CliCostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costByModel(tenantId: $tenantId, from: $from, to: $to) {
      model
      totalUsd
      inputTokens
      outputTokens
    }
  }
`);

const CostSeriesDoc = graphql(`
  query CliCostSeries($tenantId: ID!, $days: Int) {
    costTimeSeries(tenantId: $tenantId, days: $days) {
      day
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      eventCount
    }
  }
`);

interface RangeOptions extends TenantCliOptions {
  from?: string;
  to?: string;
}

interface SeriesOptions extends TenantCliOptions {
  days?: string;
}

async function runCostSummary(opts: RangeOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, CostSummaryDoc, {
    tenantId: ctx.tenantId,
    from: opts.from ?? null,
    to: opts.to ?? null,
  });
  const s = data.costSummary;
  if (isJsonMode()) {
    printJson(s);
    return;
  }
  printKeyValue([
    ["Total", `$${s.totalUsd.toFixed(2)}`],
    ["LLM", `$${s.llmUsd.toFixed(2)}`],
    ["Compute", `$${s.computeUsd.toFixed(2)}`],
    ["Tools", `$${s.toolsUsd.toFixed(2)}`],
    ["Eval", s.evalUsd != null ? `$${s.evalUsd.toFixed(2)}` : undefined],
    ["Input tokens", s.totalInputTokens.toLocaleString()],
    ["Output tokens", s.totalOutputTokens.toLocaleString()],
    ["Events", s.eventCount.toLocaleString()],
  ]);
}

async function runCostByAgent(opts: RangeOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, CostByAgentDoc, {
    tenantId: ctx.tenantId,
    from: opts.from ?? null,
    to: opts.to ?? null,
  });
  const items = data.costByAgent ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((r) => ({
      agent: r.agentName,
      id: r.agentId ?? "—",
      total: `$${r.totalUsd.toFixed(2)}`,
      events: r.eventCount.toLocaleString(),
    })),
    [
      { key: "agent", header: "AGENT" },
      { key: "id", header: "ID" },
      { key: "total", header: "TOTAL" },
      { key: "events", header: "EVENTS" },
    ],
  );
}

async function runCostByModel(opts: RangeOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, CostByModelDoc, {
    tenantId: ctx.tenantId,
    from: opts.from ?? null,
    to: opts.to ?? null,
  });
  const items = data.costByModel ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((r) => ({
      model: r.model,
      total: `$${r.totalUsd.toFixed(2)}`,
      input: r.inputTokens.toLocaleString(),
      output: r.outputTokens.toLocaleString(),
    })),
    [
      { key: "model", header: "MODEL" },
      { key: "total", header: "TOTAL" },
      { key: "input", header: "INPUT TOKENS" },
      { key: "output", header: "OUTPUT TOKENS" },
    ],
  );
}

async function runCostSeries(opts: SeriesOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, CostSeriesDoc, {
    tenantId: ctx.tenantId,
    days: opts.days ? Number.parseInt(opts.days, 10) : 30,
  });
  const items = data.costTimeSeries ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((p) => ({
      day: p.day,
      total: `$${p.totalUsd.toFixed(2)}`,
      llm: `$${p.llmUsd.toFixed(2)}`,
      compute: `$${p.computeUsd.toFixed(2)}`,
      tools: `$${p.toolsUsd.toFixed(2)}`,
      events: p.eventCount.toLocaleString(),
    })),
    [
      { key: "day", header: "DAY" },
      { key: "total", header: "TOTAL" },
      { key: "llm", header: "LLM" },
      { key: "compute", header: "COMPUTE" },
      { key: "tools", header: "TOOLS" },
      { key: "events", header: "EVENTS" },
    ],
  );
}

export function registerCostCommand(program: Command): void {
  const cost = program
    .command("cost")
    .description("Tenant spend summaries — total, per-agent, per-model, and daily series.");

  cost
    .command("summary")
    .description("Print a tenant-wide spend summary.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>", "Range start (ISO-8601)")
    .option("--to <iso>", "Range end (ISO-8601)")
    .action(runCostSummary);

  cost
    .command("by-agent")
    .description("Spend broken down by agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>")
    .option("--to <iso>")
    .action(runCostByAgent);

  cost
    .command("by-model")
    .description("Spend broken down by model.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>")
    .option("--to <iso>")
    .action(runCostByModel);

  cost
    .command("series")
    .description("Daily cost series (default last 30 days).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--days <n>", "Number of days back", "30")
    .action(runCostSeries);
}
