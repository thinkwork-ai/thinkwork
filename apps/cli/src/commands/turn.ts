/**
 * `thinkwork turn ...` — agent invocations (a.k.a. thread turns).
 *
 * Maps to threadTurns query + threadTurn + threadTurnEvents + cancelThreadTurn.
 */

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const ThreadTurnsDoc = graphql(`
  query CliThreadTurns(
    $tenantId: ID!
    $agentId: ID
    $routineId: ID
    $triggerId: ID
    $threadId: ID
    $status: String
    $limit: Int
  ) {
    threadTurns(
      tenantId: $tenantId
      agentId: $agentId
      routineId: $routineId
      triggerId: $triggerId
      threadId: $threadId
      status: $status
      limit: $limit
    ) {
      id
      agentId
      routineId
      threadId
      status
      invocationSource
      triggerName
      startedAt
      finishedAt
      totalCost
      error
    }
  }
`);

const ThreadTurnDoc = graphql(`
  query CliThreadTurn($id: ID!) {
    threadTurn(id: $id) {
      id
      tenantId
      agentId
      routineId
      threadId
      turnNumber
      status
      invocationSource
      triggerName
      triggerDetail
      startedAt
      finishedAt
      error
      errorCode
      totalCost
      lastActivityAt
      retryAttempt
      externalRunId
      sessionIdBefore
      sessionIdAfter
      createdAt
    }
  }
`);

const ThreadTurnEventsDoc = graphql(`
  query CliThreadTurnEvents($runId: ID!, $limit: Int) {
    threadTurnEvents(runId: $runId, limit: $limit) {
      seq
      eventType
      stream
      level
      message
      createdAt
    }
  }
`);

const CancelThreadTurnDoc = graphql(`
  mutation CliCancelThreadTurn($id: ID!) {
    cancelThreadTurn(id: $id) {
      id
      status
      finishedAt
    }
  }
`);

const TurnTenantBySlugDoc = graphql(`
  query CliTurnTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface TurnCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveTurnContext(opts: TurnCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, TurnTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, TurnTenantBySlugDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface ListOptions extends TurnCliOptions {
  agent?: string;
  routine?: string;
  trigger?: string;
  thread?: string;
  status?: string;
  limit?: string;
}

async function runTurnList(opts: ListOptions): Promise<void> {
  const ctx = await resolveTurnContext(opts);
  const data = await gqlQuery(ctx.client, ThreadTurnsDoc, {
    tenantId: ctx.tenantId,
    agentId: opts.agent ?? null,
    routineId: opts.routine ?? null,
    triggerId: opts.trigger ?? null,
    threadId: opts.thread ?? null,
    status: opts.status ?? null,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : 50,
  });
  const items = data.threadTurns ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((t) => ({
      id: t.id,
      status: t.status,
      agent: t.agentId ?? "—",
      source: t.invocationSource,
      trigger: t.triggerName ?? "—",
      started: fmtIso(t.startedAt),
      cost: t.totalCost != null ? `$${t.totalCost.toFixed(4)}` : "—",
    })),
    [
      { key: "id", header: "TURN ID" },
      { key: "status", header: "STATUS" },
      { key: "agent", header: "AGENT" },
      { key: "source", header: "SOURCE" },
      { key: "trigger", header: "TRIGGER" },
      { key: "started", header: "STARTED" },
      { key: "cost", header: "COST" },
    ],
  );
}

async function runTurnGet(id: string, opts: TurnCliOptions): Promise<void> {
  const ctx = await resolveTurnContext(opts);
  const data = await gqlQuery(ctx.client, ThreadTurnDoc, { id });
  const t = data.threadTurn;
  if (!t) {
    printError(`Thread turn ${id} not found.`);
    process.exit(1);
  }
  const ev = await gqlQuery(ctx.client, ThreadTurnEventsDoc, { runId: id, limit: 50 });

  if (isJsonMode()) {
    printJson({ turn: t, events: ev.threadTurnEvents ?? [] });
    return;
  }

  printKeyValue([
    ["ID", t.id],
    ["Status", t.status],
    ["Agent", t.agentId ?? undefined],
    ["Routine", t.routineId ?? undefined],
    ["Thread", t.threadId ?? undefined],
    ["Turn number", t.turnNumber ?? undefined],
    ["Source", t.invocationSource],
    ["Trigger", t.triggerName ?? undefined],
    ["Started", fmtIso(t.startedAt)],
    ["Finished", fmtIso(t.finishedAt)],
    ["Total cost", t.totalCost != null ? `$${t.totalCost.toFixed(4)}` : undefined],
    ["Retries", t.retryAttempt ?? undefined],
    ["Error", t.error ?? undefined],
    ["Error code", t.errorCode ?? undefined],
  ]);

  const events = ev.threadTurnEvents ?? [];
  if (events.length > 0) {
    console.log("\n  Events:");
    printTable(
      events.slice(0, 20).map((e) => ({
        seq: String(e.seq),
        type: e.eventType,
        level: e.level ?? "—",
        message: (e.message ?? "").slice(0, 80),
      })),
      [
        { key: "seq", header: "SEQ" },
        { key: "type", header: "TYPE" },
        { key: "level", header: "LEVEL" },
        { key: "message", header: "MESSAGE" },
      ],
    );
  }
}

interface CancelOptions extends TurnCliOptions {
  yes?: boolean;
}

async function runTurnCancel(id: string, opts: CancelOptions): Promise<void> {
  const ctx = await resolveTurnContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to cancel without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Cancel thread turn ${id}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, CancelThreadTurnDoc, { id });
  if (isJsonMode()) {
    printJson(data.cancelThreadTurn);
    return;
  }
  printSuccess(`Cancelled turn ${data.cancelThreadTurn.id} (status: ${data.cancelThreadTurn.status}).`);
}

export function registerTurnCommand(program: Command): void {
  const turn = program
    .command("turn")
    .alias("turns")
    .description("Inspect and cancel agent invocations (thread turns).");

  turn
    .command("list")
    .alias("ls")
    .description("List recent thread turns across the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Filter by agent")
    .option("--routine <id>", "Filter by routine")
    .option("--trigger <id>", "Filter by trigger ID")
    .option("--thread <id>", "Filter by thread")
    .option("--status <s>", "QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED")
    .option("--limit <n>", "Max rows", "50")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork turn list --status RUNNING
  $ thinkwork turn list --agent agt-ops --status FAILED --limit 20
`,
    )
    .action(runTurnList);

  turn
    .command("get <id>")
    .description("Fetch one thread turn with its event stream.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTurnGet);

  turn
    .command("cancel <id>")
    .description("Cancel an in-progress thread turn. No-op if already finished.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runTurnCancel);
}
