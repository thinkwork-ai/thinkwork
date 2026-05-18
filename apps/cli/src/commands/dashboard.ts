/**
 * `thinkwork dashboard` — compact overview composed from existing GraphQL
 * surfaces (agents, threads, inbox, cost summary).
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue } from "../lib/output.js";
import { resolveTenantContext, type TenantCliOptions } from "../lib/resolve-tenant-id.js";

const DashboardDoc = graphql(`
  query CliDashboard($tenantId: ID!) {
    agents(tenantId: $tenantId) {
      id
      status
    }
    threads(tenantId: $tenantId, limit: 200) {
      id
      status
      archivedAt
    }
    inboxItems(tenantId: $tenantId, status: PENDING) {
      id
    }
    costSummary(tenantId: $tenantId) {
      totalUsd
      llmUsd
      computeUsd
      eventCount
    }
  }
`);

async function runDashboard(opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, DashboardDoc, { tenantId: ctx.tenantId });

  const agents = data.agents ?? [];
  const threads = (data.threads ?? []).filter((t) => t.archivedAt == null);
  const openThreads = threads.filter(
    (t) => t.status !== "DONE" && t.status !== "CANCELLED",
  );
  const inbox = data.inboxItems ?? [];
  const cost = data.costSummary;

  if (isJsonMode()) {
    printJson({
      agents: {
        total: agents.length,
        idle: agents.filter((a) => a.status === "IDLE").length,
        busy: agents.filter((a) => a.status === "BUSY").length,
        offline: agents.filter((a) => a.status === "OFFLINE").length,
      },
      threads: { total: threads.length, open: openThreads.length },
      inbox: { pending: inbox.length },
      cost,
    });
    return;
  }

  printKeyValue([
    ["Agents", `${agents.length} total`],
    [
      "  Status",
      `IDLE: ${agents.filter((a) => a.status === "IDLE").length}, BUSY: ${agents.filter((a) => a.status === "BUSY").length}, OFFLINE: ${agents.filter((a) => a.status === "OFFLINE").length}`,
    ],
    ["Threads", `${threads.length} total, ${openThreads.length} open`],
    ["Pending approvals", String(inbox.length)],
    ["Spend (to date)", `$${cost.totalUsd.toFixed(2)} (LLM: $${cost.llmUsd.toFixed(2)}, compute: $${cost.computeUsd.toFixed(2)})`],
    ["LLM events", cost.eventCount.toLocaleString()],
  ]);
}

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .alias("overview")
    .description("One-screen snapshot of the tenant — agents, open threads, approvals, spend.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork dashboard
  $ thinkwork dashboard --stage prod
`,
    )
    .action(runDashboard);
}
