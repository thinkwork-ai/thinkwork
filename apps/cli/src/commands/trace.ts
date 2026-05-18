/**
 * `thinkwork trace ...` — LLM invocation traces for a thread or a single turn.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../lib/output.js";
import { resolveTenantContext, type TenantCliOptions } from "../lib/resolve-tenant-id.js";

const ThreadTracesDoc = graphql(`
  query CliThreadTraces($threadId: ID!, $tenantId: ID!) {
    threadTraces(threadId: $threadId, tenantId: $tenantId) {
      traceId
      threadId
      agentId
      agentName
      model
      inputTokens
      outputTokens
      durationMs
      costUsd
      estimated
    }
  }
`);

const TurnInvocationLogsDoc = graphql(`
  query CliTurnInvocationLogs($tenantId: ID!, $turnId: ID!) {
    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {
      requestId
      modelId
      timestamp
      inputTokenCount
      outputTokenCount
      cacheReadTokenCount
      toolCount
      costUsd
    }
  }
`);

async function runTraceThread(threadId: string, opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, ThreadTracesDoc, {
    threadId,
    tenantId: ctx.tenantId,
  });
  const items = data.threadTraces ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((t) => ({
      traceId: t.traceId.slice(0, 16),
      agent: t.agentName ?? "—",
      model: t.model ?? "—",
      input: t.inputTokens != null ? t.inputTokens.toLocaleString() : "—",
      output: t.outputTokens != null ? t.outputTokens.toLocaleString() : "—",
      durMs: t.durationMs != null ? String(t.durationMs) : "—",
      cost: t.costUsd != null ? `$${t.costUsd.toFixed(4)}` : "—",
    })),
    [
      { key: "traceId", header: "TRACE ID" },
      { key: "agent", header: "AGENT" },
      { key: "model", header: "MODEL" },
      { key: "input", header: "INPUT TOKENS" },
      { key: "output", header: "OUTPUT TOKENS" },
      { key: "durMs", header: "DUR (ms)" },
      { key: "cost", header: "COST" },
    ],
  );
}

async function runTraceTurn(turnId: string, opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, TurnInvocationLogsDoc, {
    tenantId: ctx.tenantId,
    turnId,
  });
  const items = data.turnInvocationLogs ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((m) => ({
      requestId: m.requestId.slice(0, 16),
      model: m.modelId,
      when: m.timestamp,
      input: m.inputTokenCount.toLocaleString(),
      output: m.outputTokenCount.toLocaleString(),
      cache: m.cacheReadTokenCount.toLocaleString(),
      tools: m.toolCount != null ? String(m.toolCount) : "—",
      cost: m.costUsd != null ? `$${m.costUsd.toFixed(4)}` : "—",
    })),
    [
      { key: "requestId", header: "REQUEST" },
      { key: "model", header: "MODEL" },
      { key: "when", header: "WHEN" },
      { key: "input", header: "INPUT" },
      { key: "output", header: "OUTPUT" },
      { key: "cache", header: "CACHE READ" },
      { key: "tools", header: "TOOLS" },
      { key: "cost", header: "COST" },
    ],
  );
}

export function registerTraceCommand(program: Command): void {
  const trace = program
    .command("trace")
    .description("LLM invocation traces for a thread or a single turn.");

  trace
    .command("thread <threadId>")
    .description("Trace events for a thread (every LLM call across every turn).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTraceThread);

  trace
    .command("turn <turnId>")
    .description("Per-invocation logs for a single thread turn.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTraceTurn);
}
