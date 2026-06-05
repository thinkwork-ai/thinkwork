/**
 * `thinkwork budget ...` — tenant or per-user spend policies.
 */

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, logStderr, printJson, printTable } from "../lib/output.js";
import { printError, printSuccess } from "../ui.js";
import {
  resolveTenantContext,
  type TenantCliOptions,
} from "../lib/resolve-tenant-id.js";

const BudgetPoliciesDoc = graphql(`
  query CliBudgetPolicies($tenantId: ID!) {
    budgetPolicies(tenantId: $tenantId) {
      id
      scope
      agentId
      userId
      period
      limitUsd
      actionOnExceed
      enabled
    }
  }
`);

const BudgetStatusDoc = graphql(`
  query CliBudgetStatus($tenantId: ID!) {
    budgetStatus(tenantId: $tenantId) {
      policy {
        id
        scope
        agentId
        userId
        period
        limitUsd
      }
      spentUsd
      remainingUsd
      percentUsed
      status
    }
  }
`);

const UpsertBudgetPolicyDoc = graphql(`
  mutation CliUpsertBudgetPolicy(
    $tenantId: ID!
    $input: UpsertBudgetPolicyInput!
  ) {
    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {
      id
      scope
      agentId
      userId
      limitUsd
      period
      actionOnExceed
    }
  }
`);

const DeleteBudgetPolicyDoc = graphql(`
  mutation CliDeleteBudgetPolicy($id: ID!) {
    deleteBudgetPolicy(id: $id)
  }
`);

async function runBudgetList(opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, BudgetPoliciesDoc, {
    tenantId: ctx.tenantId,
  });
  const items = data.budgetPolicies ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((p) => ({
      id: p.id,
      scope: p.scope,
      target: formatBudgetTarget(p.scope, p.userId ?? null, p.agentId ?? null),
      period: p.period,
      limit: `$${p.limitUsd.toFixed(2)}`,
      action: p.actionOnExceed,
      enabled: p.enabled ? "yes" : "no",
    })),
    [
      { key: "id", header: "POLICY ID" },
      { key: "scope", header: "SCOPE" },
      { key: "target", header: "TARGET" },
      { key: "period", header: "PERIOD" },
      { key: "limit", header: "LIMIT" },
      { key: "action", header: "ON EXCEED" },
      { key: "enabled", header: "ON" },
    ],
  );
}

async function runBudgetStatus(opts: TenantCliOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  const data = await gqlQuery(ctx.client, BudgetStatusDoc, {
    tenantId: ctx.tenantId,
  });
  const items = data.budgetStatus ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((s) => ({
      id: s.policy.id,
      scope: s.policy.scope,
      target: formatBudgetTarget(
        s.policy.scope,
        s.policy.userId ?? null,
        s.policy.agentId ?? null,
      ),
      period: s.policy.period,
      limit: `$${s.policy.limitUsd.toFixed(2)}`,
      spent: `$${s.spentUsd.toFixed(2)}`,
      pct: `${s.percentUsed.toFixed(1)}%`,
      status: s.status,
    })),
    [
      { key: "id", header: "POLICY ID" },
      { key: "scope", header: "SCOPE" },
      { key: "target", header: "TARGET" },
      { key: "period", header: "PERIOD" },
      { key: "limit", header: "LIMIT" },
      { key: "spent", header: "SPENT" },
      { key: "pct", header: "USED" },
      { key: "status", header: "STATUS" },
    ],
  );
}

interface UpsertOptions extends TenantCliOptions {
  scope?: string;
  agent?: string;
  user?: string;
  limitUsd?: string;
  period?: string;
  action?: string;
}

function formatBudgetTarget(
  scope: string,
  userId: string | null,
  agentId: string | null,
): string {
  if (scope === "user") return userId ? `user:${userId}` : "user:—";
  if (scope === "agent") return agentId ? `agent:${agentId}` : "agent:—";
  return "tenant";
}

function normalizeBudgetScope(scope: string): "tenant" | "user" | "agent" {
  if (scope === "tenant" || scope === "user" || scope === "agent") {
    return scope;
  }
  printError(`--scope "${scope}" must be one of tenant, user, or agent.`);
  process.exit(1);
}

async function runBudgetUpsert(opts: UpsertOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  if (!opts.scope) {
    printError("--scope <tenant|user> is required.");
    process.exit(1);
  }
  const scope = normalizeBudgetScope(opts.scope);
  if (scope === "user" && !opts.user) {
    printError("--user <id> is required when --scope user.");
    process.exit(1);
  }
  if (scope === "agent" && !opts.agent) {
    printError("--agent <id> is required when --scope agent.");
    process.exit(1);
  }
  if (scope === "tenant" && (opts.user || opts.agent)) {
    printError("--user and --agent are only valid for scoped budgets.");
    process.exit(1);
  }
  if (scope === "user" && opts.agent) {
    printError("--agent cannot be used with --scope user.");
    process.exit(1);
  }
  if (scope === "agent" && opts.user) {
    printError("--user cannot be used with --scope agent.");
    process.exit(1);
  }
  if (!opts.limitUsd) {
    printError("--limit-usd <amount> is required.");
    process.exit(1);
  }
  const limit = Number.parseFloat(opts.limitUsd);
  if (!Number.isFinite(limit) || limit <= 0) {
    printError(`--limit-usd "${opts.limitUsd}" must be a positive number.`);
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpsertBudgetPolicyDoc, {
    tenantId: ctx.tenantId,
    input: {
      scope,
      agentId: scope === "agent" ? opts.agent! : null,
      userId: scope === "user" ? opts.user! : null,
      limitUsd: limit,
      period: opts.period ?? "monthly",
      actionOnExceed: opts.action ?? "PAUSE",
    },
  });
  if (isJsonMode()) {
    printJson(data.upsertBudgetPolicy);
    return;
  }
  printSuccess(
    `Upserted ${data.upsertBudgetPolicy.scope} budget — $${data.upsertBudgetPolicy.limitUsd.toFixed(2)}/${data.upsertBudgetPolicy.period} (id: ${data.upsertBudgetPolicy.id}).`,
  );
}

interface DeleteOptions extends TenantCliOptions {
  yes?: boolean;
}

async function runBudgetDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveTenantContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete budget policy ${id}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteBudgetPolicyDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteBudgetPolicy });
    return;
  }
  if (data.deleteBudgetPolicy) printSuccess(`Deleted budget policy ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

export function registerBudgetCommand(program: Command): void {
  const budget = program
    .command("budget")
    .description("Tenant and user spend policies + status.");

  budget
    .command("list")
    .alias("ls")
    .description("List budget policies in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runBudgetList);

  budget
    .command("status")
    .description("Show spend vs limit for each policy.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runBudgetStatus);

  budget
    .command("upsert")
    .description("Create or replace a budget policy.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--scope <s>", "tenant | user (agent accepted for legacy policies)")
    .option("--user <id>", "Required when --scope user")
    .option("--agent <id>", "Legacy: required when --scope agent")
    .option("--limit-usd <n>", "USD ceiling")
    .option("--period <p>", "daily | weekly | monthly", "monthly")
    .option("--action <a>", "PAUSE | ALERT", "PAUSE")
    .action(runBudgetUpsert);

  budget
    .command("delete <id>")
    .description("Delete a budget policy.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runBudgetDelete);
}
