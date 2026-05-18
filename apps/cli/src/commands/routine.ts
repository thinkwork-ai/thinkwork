/**
 * `thinkwork routine ...` — saved workflows with triggers and run history.
 *
 * Maps to routines/routine queries + create/update/delete mutations,
 * triggerRoutineRun + routineExecutions for run history, and
 * setRoutineTrigger/deleteRoutineTrigger for trigger configuration.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { RoutineStatus, RoutineExecutionStatus } from "../gql/graphql.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const RoutinesDoc = graphql(`
  query CliRoutines($tenantId: ID!, $teamId: ID, $agentId: ID, $status: RoutineStatus) {
    routines(tenantId: $tenantId, teamId: $teamId, agentId: $agentId, status: $status) {
      id
      name
      type
      status
      engine
      schedule
      agentId
      teamId
      lastRunAt
      nextRunAt
    }
  }
`);

const RoutineDoc = graphql(`
  query CliRoutine($id: ID!) {
    routine(id: $id) {
      id
      name
      description
      type
      status
      engine
      schedule
      agentId
      teamId
      visibility
      owningAgentId
      currentVersion
      lastRunAt
      nextRunAt
      createdAt
      updatedAt
      triggers {
        id
        triggerType
        enabled
        config
      }
    }
  }
`);

const CreateRoutineDoc = graphql(`
  mutation CliCreateRoutine($input: CreateRoutineInput!) {
    createRoutine(input: $input) {
      id
      name
      type
      status
    }
  }
`);

const UpdateRoutineDoc = graphql(`
  mutation CliUpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {
    updateRoutine(id: $id, input: $input) {
      id
      name
      status
    }
  }
`);

const DeleteRoutineDoc = graphql(`
  mutation CliDeleteRoutine($id: ID!) {
    deleteRoutine(id: $id)
  }
`);

const TriggerRoutineRunDoc = graphql(`
  mutation CliTriggerRoutineRun($routineId: ID!, $input: AWSJSON) {
    triggerRoutineRun(routineId: $routineId, input: $input) {
      id
      status
      startedAt
    }
  }
`);

const RoutineExecutionsDoc = graphql(`
  query CliRoutineExecutions($routineId: ID!, $status: RoutineExecutionStatus, $limit: Int, $cursor: String) {
    routineExecutions(routineId: $routineId, status: $status, limit: $limit, cursor: $cursor) {
      id
      status
      startedAt
      finishedAt
      errorMessage
    }
  }
`);

const RoutineExecutionDoc = graphql(`
  query CliRoutineExecution($id: ID!) {
    routineExecution(id: $id) {
      id
      routineId
      status
      startedAt
      finishedAt
      errorMessage
      inputJson
      outputJson
    }
  }
`);

const SetRoutineTriggerDoc = graphql(`
  mutation CliSetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {
    setRoutineTrigger(routineId: $routineId, input: $input) {
      id
      triggerType
      enabled
    }
  }
`);

const DeleteRoutineTriggerDoc = graphql(`
  mutation CliDeleteRoutineTrigger($id: ID!) {
    deleteRoutineTrigger(id: $id)
  }
`);

const RoutineTenantBySlugDoc = graphql(`
  query CliRoutineTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface RoutineCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveRoutineContext(opts: RoutineCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, RoutineTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, RoutineTenantBySlugDoc, { slug: ctxSlug });
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

interface ListOptions extends RoutineCliOptions {
  agent?: string;
  team?: string;
  status?: string;
}

const ROUTINE_STATUS_BY_NAME: Record<string, RoutineStatus> = {
  ACTIVE: RoutineStatus.Active,
  PAUSED: RoutineStatus.Paused,
  ARCHIVED: RoutineStatus.Archived,
};

const ROUTINE_EXEC_STATUS_BY_NAME: Record<string, RoutineExecutionStatus> = {
  AWAITING_APPROVAL: RoutineExecutionStatus.AwaitingApproval,
  CANCELLED: RoutineExecutionStatus.Cancelled,
  FAILED: RoutineExecutionStatus.Failed,
  RUNNING: RoutineExecutionStatus.Running,
  SUCCEEDED: RoutineExecutionStatus.Succeeded,
};

function parseStatus<E extends string>(
  raw: string | undefined,
  table: Record<string, E>,
  label: string,
): E | null {
  if (!raw) return null;
  const v = table[raw.toUpperCase()];
  if (!v) {
    printError(`Invalid ${label} "${raw}". Expected one of: ${Object.keys(table).join(", ")}.`);
    process.exit(1);
  }
  return v;
}

async function runRoutineList(opts: ListOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  const data = await gqlQuery(ctx.client, RoutinesDoc, {
    tenantId: ctx.tenantId,
    teamId: opts.team ?? null,
    agentId: opts.agent ?? null,
    status: parseStatus(opts.status, ROUTINE_STATUS_BY_NAME, "--status"),
  });
  const items = data.routines ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: r.status,
      engine: r.engine,
      schedule: r.schedule ?? "—",
      lastRun: fmtIso(r.lastRunAt),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "type", header: "TYPE" },
      { key: "status", header: "STATUS" },
      { key: "engine", header: "ENGINE" },
      { key: "schedule", header: "SCHEDULE" },
      { key: "lastRun", header: "LAST RUN" },
    ],
  );
}

async function runRoutineGet(id: string, opts: RoutineCliOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  const data = await gqlQuery(ctx.client, RoutineDoc, { id });
  const r = data.routine;
  if (!r) {
    printError(`Routine ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(r);
    return;
  }
  printKeyValue([
    ["ID", r.id],
    ["Name", r.name],
    ["Description", r.description ?? undefined],
    ["Type", r.type],
    ["Status", r.status],
    ["Engine", r.engine],
    ["Visibility", r.visibility],
    ["Owning agent", r.owningAgentId ?? undefined],
    ["Agent", r.agentId ?? undefined],
    ["Team", r.teamId ?? undefined],
    ["Schedule", r.schedule ?? undefined],
    ["Current version", r.currentVersion ?? undefined],
    ["Last run", fmtIso(r.lastRunAt)],
    ["Next run", fmtIso(r.nextRunAt)],
    ["Created", fmtIso(r.createdAt)],
  ]);
  if (r.triggers && r.triggers.length > 0) {
    console.log("\n  Triggers:");
    printTable(
      r.triggers.map((t) => ({
        id: t.id,
        type: t.triggerType,
        enabled: t.enabled ? "yes" : "no",
        config: t.config ? JSON.stringify(t.config).slice(0, 50) : "—",
      })),
      [
        { key: "id", header: "TRIGGER ID" },
        { key: "type", header: "TYPE" },
        { key: "enabled", header: "ON" },
        { key: "config", header: "CONFIG" },
      ],
    );
  }
}

interface CreateOptions extends RoutineCliOptions {
  agent?: string;
  team?: string;
  description?: string;
  config?: string;
  configFile?: string;
}

async function runRoutineCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Routine name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Routine name");
    resolvedName = await promptOrExit(() => input({ message: "Routine name:" }));
  }
  let aslJson: unknown = null;
  if (opts.config) {
    try {
      aslJson = JSON.parse(opts.config);
    } catch (err) {
      printError(`--config is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  } else if (opts.configFile) {
    const txt = await readFile(opts.configFile, "utf-8");
    try {
      aslJson = JSON.parse(txt);
    } catch (err) {
      printError(`--config-file does not parse as JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const data = await gqlMutate(ctx.client, CreateRoutineDoc, {
    input: {
      tenantId: ctx.tenantId,
      name: resolvedName!,
      description: opts.description ?? null,
      agentId: opts.agent ?? null,
      teamId: opts.team ?? null,
      asl: aslJson,
    },
  });
  if (isJsonMode()) {
    printJson(data.createRoutine);
    return;
  }
  printSuccess(
    `Created routine ${data.createRoutine.id} — ${data.createRoutine.name} (type: ${data.createRoutine.type}, status: ${data.createRoutine.status}).`,
  );
}

interface UpdateOptions extends RoutineCliOptions {
  name?: string;
  status?: string;
  agent?: string;
  team?: string;
  configFile?: string;
}

async function runRoutineUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.status !== undefined) input.status = opts.status;
  if (opts.agent !== undefined) input.agentId = opts.agent;
  if (opts.team !== undefined) input.teamId = opts.team;
  if (Object.keys(input).length === 0) {
    printError("Nothing to update.");
    process.exit(1);
  }
  if (opts.configFile) {
    printError(
      "--config-file is not honored on update — ASL changes go through publishRoutineVersion. Use the admin UI for ASL edits.",
    );
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateRoutineDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateRoutine);
    return;
  }
  printSuccess(`Updated routine ${data.updateRoutine.id}.`);
}

interface DeleteOptions extends RoutineCliOptions {
  yes?: boolean;
}

async function runRoutineDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete routine ${id}? Past runs + triggers are removed.`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteRoutineDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteRoutine });
    return;
  }
  if (data.deleteRoutine) printSuccess(`Deleted routine ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

interface TriggerOptions extends RoutineCliOptions {
  input?: string;
  wait?: boolean;
}

async function runRoutineTrigger(id: string, opts: TriggerOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  let payload: unknown = null;
  if (opts.input) {
    try {
      payload = JSON.parse(opts.input);
    } catch (err) {
      printError(`--input is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  const data = await gqlMutate(ctx.client, TriggerRoutineRunDoc, {
    routineId: id,
    input: payload,
  });
  if (isJsonMode()) {
    printJson(data.triggerRoutineRun);
    return;
  }
  printSuccess(
    `Triggered routine ${id} — execution ${data.triggerRoutineRun.id} (status: ${data.triggerRoutineRun.status}).`,
  );
  if (opts.wait) {
    console.log("  (--wait is not yet implemented; poll `routine run get` until status is terminal.)");
  }
}

interface RunListOptions extends RoutineCliOptions {
  limit?: string;
  cursor?: string;
  status?: string;
}

async function runRoutineRunList(
  routineId: string,
  opts: RunListOptions,
): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  const data = await gqlQuery(ctx.client, RoutineExecutionsDoc, {
    routineId,
    status: parseStatus(opts.status, ROUTINE_EXEC_STATUS_BY_NAME, "--status"),
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : 25,
    cursor: opts.cursor ?? null,
  });
  const items = data.routineExecutions ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((e) => ({
      id: e.id,
      status: e.status,
      started: fmtIso(e.startedAt),
      finished: fmtIso(e.finishedAt),
      errorMessage: e.errorMessage ? e.errorMessage.slice(0, 40) : "—",
    })),
    [
      { key: "id", header: "RUN ID" },
      { key: "status", header: "STATUS" },
      { key: "started", header: "STARTED" },
      { key: "finished", header: "FINISHED" },
      { key: "errorMessage", header: "ERROR" },
    ],
  );
}

async function runRoutineRunGet(runId: string, opts: RoutineCliOptions): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  const data = await gqlQuery(ctx.client, RoutineExecutionDoc, { id: runId });
  const e = data.routineExecution;
  if (!e) {
    printError(`Routine execution ${runId} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(e);
    return;
  }
  printKeyValue([
    ["ID", e.id],
    ["Routine", e.routineId],
    ["Status", e.status],
    ["Started", fmtIso(e.startedAt)],
    ["Finished", fmtIso(e.finishedAt)],
    ["Error", e.errorMessage ?? undefined],
  ]);
}

interface TriggerSetOptions extends RoutineCliOptions {
  type?: string;
  schedule?: string;
  event?: string;
}

async function runRoutineTriggerConfigSet(
  routineId: string,
  opts: TriggerSetOptions,
): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  if (!opts.type) {
    printError("--type <CRON|WEBHOOK|EVENT> is required.");
    process.exit(1);
  }
  const config: Record<string, unknown> = {};
  if (opts.schedule) config.cronExpression = opts.schedule;
  if (opts.event) config.eventName = opts.event;
  const data = await gqlMutate(ctx.client, SetRoutineTriggerDoc, {
    routineId,
    input: {
      triggerType: opts.type,
      config: Object.keys(config).length > 0 ? config : null,
      enabled: true,
    },
  });
  if (isJsonMode()) {
    printJson(data.setRoutineTrigger);
    return;
  }
  printSuccess(
    `Set ${data.setRoutineTrigger.triggerType} trigger on routine ${routineId} (id: ${data.setRoutineTrigger.id}, enabled: ${data.setRoutineTrigger.enabled}).`,
  );
}

interface TriggerDeleteOptions extends RoutineCliOptions {
  yes?: boolean;
}

async function runRoutineTriggerConfigDelete(
  triggerId: string,
  opts: TriggerDeleteOptions,
): Promise<void> {
  const ctx = await resolveRoutineContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete trigger ${triggerId}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteRoutineTriggerDoc, { id: triggerId });
  if (isJsonMode()) {
    printJson({ id: triggerId, deleted: data.deleteRoutineTrigger });
    return;
  }
  if (data.deleteRoutineTrigger) printSuccess(`Deleted trigger ${triggerId}.`);
  else printError(`Server reported not-deleted for ${triggerId}.`);
}

export function registerRoutineCommand(program: Command): void {
  const routine = program
    .command("routine")
    .alias("routines")
    .description("Manage routines — saved workflows, their triggers, and past runs.");

  routine
    .command("list")
    .alias("ls")
    .description("List routines in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Filter by agent")
    .option("--team <id>", "Filter by team")
    .option("--status <s>", "ACTIVE | PAUSED | ARCHIVED")
    .action(runRoutineList);

  routine
    .command("get <id>")
    .description("Fetch one routine with its triggers.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runRoutineGet);

  routine
    .command("create [name]")
    .description("Create a new routine. Walkthrough for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent that runs the routine")
    .option("--team <id>", "Team to route runs to (instead of a single agent)")
    .option("--description <text>")
    .option("--config <json>", "Inline ASL JSON")
    .option("--config-file <path>", "Load ASL JSON from a file")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork routine create "Nightly digest" --agent agt-editor --config-file routines/digest.json
`,
    )
    .action(runRoutineCreate);

  routine
    .command("update <id>")
    .description("Update routine metadata (name/status/assignment). ASL changes go through publish.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--status <s>", "ACTIVE | PAUSED | ARCHIVED")
    .option("--agent <id>")
    .option("--team <id>")
    .option("--config-file <path>", "(not supported — ASL is published separately)")
    .action(runRoutineUpdate);

  routine
    .command("delete <id>")
    .description("Delete a routine. Past runs and triggers are removed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runRoutineDelete);

  routine
    .command("trigger <id>")
    .description("Trigger a routine run now (ad-hoc).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "(not yet implemented) block until the run finishes")
    .option("--input <json>", "Optional input payload")
    .action(runRoutineTrigger);

  // ----- Runs sub-group -----------------------------------------------------
  const run = routine
    .command("run")
    .description("Inspect routine run history.");

  run
    .command("list <routineId>")
    .alias("ls")
    .description("List recent runs of a routine.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max rows", "25")
    .option("--cursor <c>", "Pagination cursor")
    .option("--status <s>", "Filter by execution status")
    .action(runRoutineRunList);

  run
    .command("get <runId>")
    .description("Fetch one run.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runRoutineRunGet);

  // ----- Triggers -----------------------------------------------------------
  const trigger = routine
    .command("trigger-config")
    .description("Manage a routine's triggers (cron, webhook, event).");

  trigger
    .command("set <routineId>")
    .description("Set or replace a trigger for a routine.")
    .option("--type <t>", "CRON | WEBHOOK | EVENT")
    .option("--schedule <cron>", "Cron expression (for CRON triggers)")
    .option("--event <name>", "Event name (for EVENT triggers)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork routine trigger-config set rtn-digest --type CRON --schedule "0 9 * * *"
`,
    )
    .action(runRoutineTriggerConfigSet);

  trigger
    .command("delete <triggerId>")
    .description("Remove a trigger.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runRoutineTriggerConfigDelete);
}
