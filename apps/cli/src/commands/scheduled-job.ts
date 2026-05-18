/**
 * `thinkwork scheduled-job ...` — AWS Scheduler-backed recurring jobs that
 * invoke agents on a schedule.
 *
 * GraphQL surface today exposes only list/get/create (createScheduledJob).
 * update/delete/run are scaffolded but return clear "API not yet implemented"
 * errors until the server adds the mutations. Tracked as Phase-3 follow-up.
 */

import { Command } from "commander";
import { input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const ScheduledJobsDoc = graphql(`
  query CliScheduledJobs(
    $tenantId: ID!
    $agentId: ID
    $routineId: ID
    $triggerType: String
    $enabled: Boolean
    $limit: Int
  ) {
    scheduledJobs(
      tenantId: $tenantId
      agentId: $agentId
      routineId: $routineId
      triggerType: $triggerType
      enabled: $enabled
      limit: $limit
    ) {
      id
      name
      description
      triggerType
      agentId
      routineId
      scheduleType
      scheduleExpression
      timezone
      enabled
      lastRunAt
      nextRunAt
      createdAt
    }
  }
`);

const ScheduledJobDoc = graphql(`
  query CliScheduledJob($id: ID!) {
    scheduledJob(id: $id) {
      id
      name
      description
      triggerType
      agentId
      routineId
      prompt
      scheduleType
      scheduleExpression
      timezone
      enabled
      ebScheduleName
      lastRunAt
      nextRunAt
      createdAt
      updatedAt
    }
  }
`);

const CreateScheduledJobDoc = graphql(`
  mutation CliCreateScheduledJob($input: CreateScheduledJobInput!) {
    createScheduledJob(input: $input) {
      id
      name
      enabled
      scheduleExpression
      timezone
    }
  }
`);

const DeleteScheduledJobDoc = graphql(`
  mutation CliDeleteScheduledJob($id: ID!) {
    deleteScheduledJob(id: $id) {
      id
      ok
    }
  }
`);

const SchedJobTenantBySlugDoc = graphql(`
  query CliSchedJobTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface SchedCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveSchedContext(opts: SchedCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, SchedJobTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, SchedJobTenantBySlugDoc, { slug: ctxSlug });
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

interface ListOptions extends SchedCliOptions {
  agent?: string;
  routine?: string;
  enabled?: string;
}

async function runSchedList(opts: ListOptions): Promise<void> {
  const ctx = await resolveSchedContext(opts);
  const enabled = opts.enabled === undefined ? null : opts.enabled === "true";
  const data = await gqlQuery(ctx.client, ScheduledJobsDoc, {
    tenantId: ctx.tenantId,
    agentId: opts.agent ?? null,
    routineId: opts.routine ?? null,
    triggerType: null,
    enabled,
    limit: 100,
  });
  const items = data.scheduledJobs ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((j) => ({
      id: j.id,
      name: j.name,
      type: j.triggerType,
      target: j.agentId ?? j.routineId ?? "—",
      schedule: j.scheduleExpression ?? "—",
      enabled: j.enabled ? "yes" : "no",
      next: fmtIso(j.nextRunAt),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "type", header: "TYPE" },
      { key: "target", header: "TARGET" },
      { key: "schedule", header: "SCHEDULE" },
      { key: "enabled", header: "ON" },
      { key: "next", header: "NEXT RUN" },
    ],
  );
}

async function runSchedGet(id: string, opts: SchedCliOptions): Promise<void> {
  const ctx = await resolveSchedContext(opts);
  const data = await gqlQuery(ctx.client, ScheduledJobDoc, { id });
  const j = data.scheduledJob;
  if (!j) {
    printError(`Scheduled job ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(j);
    return;
  }
  printKeyValue([
    ["ID", j.id],
    ["Name", j.name],
    ["Description", j.description ?? undefined],
    ["Trigger type", j.triggerType],
    ["Agent", j.agentId ?? undefined],
    ["Routine", j.routineId ?? undefined],
    ["Schedule", j.scheduleExpression ?? undefined],
    ["Timezone", j.timezone],
    ["Enabled", j.enabled ? "yes" : "no"],
    ["EB rule", j.ebScheduleName ?? undefined],
    ["Last run", fmtIso(j.lastRunAt)],
    ["Next run", fmtIso(j.nextRunAt)],
    ["Created", fmtIso(j.createdAt)],
    ["Updated", fmtIso(j.updatedAt)],
  ]);
  if (j.prompt) {
    console.log("\n  Prompt:");
    console.log(`  ${j.prompt.slice(0, 300)}${j.prompt.length > 300 ? "…" : ""}`);
  }
}

interface CreateOptions extends SchedCliOptions {
  agent?: string;
  routine?: string;
  schedule?: string;
  timezone?: string;
  payload?: string;
  disabled?: boolean;
}

async function runSchedCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveSchedContext(opts);
  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Job name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Job name");
    resolvedName = await promptOrExit(() => input({ message: "Job name:" }));
  }

  if (!opts.schedule) {
    printError("--schedule <expr> is required (e.g. \"cron(0 9 * * ? *)\" or \"rate(1 hour)\").");
    process.exit(1);
  }

  if (!opts.agent && !opts.routine) {
    printError("Either --agent <id> or --routine <id> is required.");
    process.exit(1);
  }

  let config: unknown = null;
  if (opts.payload) {
    try {
      config = JSON.parse(opts.payload);
    } catch (err) {
      printError(`--payload is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const isCron = opts.schedule.trim().startsWith("cron(");

  const data = await gqlMutate(ctx.client, CreateScheduledJobDoc, {
    input: {
      tenantId: ctx.tenantId,
      triggerType: opts.routine ? "routine" : "agent",
      agentId: opts.agent ?? null,
      routineId: opts.routine ?? null,
      name: resolvedName!,
      description: null,
      prompt: null,
      config,
      scheduleType: isCron ? "cron" : "rate",
      scheduleExpression: opts.schedule,
      timezone: opts.timezone ?? "UTC",
    },
  });
  if (isJsonMode()) {
    printJson(data.createScheduledJob);
    return;
  }
  printSuccess(
    `Created scheduled job ${data.createScheduledJob.id} — ${data.createScheduledJob.name} (${data.createScheduledJob.scheduleExpression}, ${data.createScheduledJob.timezone}).`,
  );
}

interface DeleteOptions extends SchedCliOptions {
  yes?: boolean;
}

async function runSchedDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveSchedContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError(
        "Refusing to delete without --yes in non-interactive mode (CI / piped stdin).",
      );
      process.exit(1);
    }
    requireTty("confirmation");
    const answer = await promptOrExit(() =>
      input({
        message: `Delete scheduled job ${id}? Type "delete" to confirm:`,
      }),
    );
    if (answer.trim() !== "delete") {
      console.log("  Cancelled.");
      return;
    }
  }
  const data = await gqlMutate(ctx.client, DeleteScheduledJobDoc, { id });
  if (isJsonMode()) {
    printJson(data.deleteScheduledJob);
    return;
  }
  if (data.deleteScheduledJob.ok) {
    printSuccess(`Deleted scheduled job ${data.deleteScheduledJob.id}.`);
  } else {
    console.log(
      `  Scheduled job ${id} was already deleted (no row matched).`,
    );
  }
}

function notYetImplementedAtApi(verb: string): never {
  printError(
    `\`scheduled-job ${verb}\` is not yet implemented at the GraphQL API.\n` +
      "  The server only exposes scheduledJobs / scheduledJob / createScheduledJob today.\n" +
      "  Use the admin UI for update/delete/run operations; CLI parity is tracked as a Phase-3 follow-up.",
  );
  process.exit(2);
}

export function registerScheduledJobCommand(program: Command): void {
  const job = program
    .command("scheduled-job")
    .alias("cron")
    .description("Manage AWS-Scheduler-backed recurring agent jobs (wakeups on a cadence).");

  job
    .command("list")
    .alias("ls")
    .description("List scheduled jobs for the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Filter by agent")
    .option("--routine <id>", "Filter by routine")
    .option("--enabled <bool>", "true | false")
    .action(runSchedList);

  job
    .command("get <id>")
    .description("Fetch one scheduled job.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runSchedGet);

  job
    .command("create [name]")
    .description("Create a new scheduled job. Supports cron() or rate() schedules.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent to wake up")
    .option("--routine <id>", "Or: routine to trigger")
    .option("--schedule <expr>", "EventBridge schedule (cron(…) or rate(…))")
    .option("--timezone <tz>", "IANA timezone (default: UTC)", "UTC")
    .option("--payload <json>", "Payload to pass to the agent/routine (becomes the job's config)")
    .option("--disabled", "Create in disabled state (currently honored at the resolver level only)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork scheduled-job create "Daily ops digest" \\
      --agent agt-editor --schedule "cron(0 9 * * ? *)" --timezone America/New_York

  # rate() — "every N time from creation", NOT wall-clock.
  $ thinkwork scheduled-job create "Hourly check" --agent agt-check --schedule "rate(1 hour)"
`,
    )
    .action(runSchedCreate);

  job
    .command("update <id>")
    .description("Update a scheduled job. (API surface pending — currently a no-op.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--schedule <expr>")
    .option("--timezone <tz>")
    .option("--payload <json>")
    .option("--enable")
    .option("--disable")
    .action(() => notYetImplementedAtApi("update"));

  job
    .command("delete <id>")
    .description(
      "Delete a scheduled job. Deprovisions the EventBridge schedule first, then removes the row.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runSchedDelete);

  job
    .command("run <id>")
    .description("Trigger a scheduled job immediately. (API surface pending.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "Block until the run completes")
    .action(() => notYetImplementedAtApi("run"));
}
