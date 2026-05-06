import { Command } from "commander";
import chalk from "chalk";
import { apiFetchRaw, resolveApiConfig } from "../api-client.js";
import { printError, printHeader, printSuccess, printWarning } from "../ui.js";
import { isJsonMode, printJson, printTable } from "../lib/output.js";
import { resolveStage } from "../lib/resolve-stage.js";

type MigrationResponse = {
  ok: boolean;
  mode: "dry-run" | "apply";
  report?: {
    summary?: Record<string, number>;
    groups?: Array<{
      owner?: { name?: string | null; email?: string | null } | null;
      ownerUserId?: string | null;
      status: string;
      severity?: string;
      recommendedAction?: string;
      applyDisposition?: string;
      primaryAgent?: { name?: string; templateName?: string | null } | null;
      primaryAgentId?: string | null;
      existingComputerId?: string;
      reasons?: string[];
    }>;
  };
  created?: string[];
  skipped?: string[];
  error?: string;
  blockers?: unknown[];
};

type RuntimeAction = "provision" | "start" | "stop" | "restart" | "status";
type RuntimeResponse = {
  ok: boolean;
  action?: RuntimeAction;
  result?: Record<string, unknown>;
  error?: string;
};

type TaskResponse = {
  task?: {
    id: string;
    taskType: string;
    status: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
  };
  error?: string;
};

async function resolveComputerContext(opts: { stage?: string }) {
  const stage = await resolveStage({ flag: opts.stage });
  const api = resolveApiConfig(stage);
  if (!api) process.exit(1);
  return { stage, api };
}

function resolveTenantId(opts: { tenant?: string; tenantId?: string }): string {
  const tenantId = opts.tenant ?? opts.tenantId;
  if (!tenantId) {
    printError(
      "Tenant ID is required. Pass --tenant <uuid> or --tenant-id <uuid>.",
    );
    process.exit(1);
  }
  return tenantId;
}

function resolveComputerId(opts: { computer?: string; computerId?: string }) {
  const computerId = opts.computer ?? opts.computerId;
  if (!computerId) {
    printError(
      "Computer ID is required. Pass --computer <uuid> or --computer-id <uuid>.",
    );
    process.exit(1);
  }
  return computerId;
}

function resolveTaskType(opts: { type?: string }) {
  if (!opts.type?.trim()) {
    printError("Task type is required. Pass --type <task-type>.");
    process.exit(1);
  }
  return opts.type.trim().toLowerCase();
}

function printMigrationReport(response: MigrationResponse): void {
  printJson(response);
  if (isJsonMode()) return;
  if (!response.report) return;

  const summary = response.report.summary ?? {};
  console.log("");
  console.log(chalk.bold("  Summary"));
  for (const [status, count] of Object.entries(summary)) {
    if (!count) continue;
    console.log(`  ${status.padEnd(28)} ${count}`);
  }

  const rows = (response.report.groups ?? []).map((group) => ({
    owner:
      group.owner?.name ??
      group.owner?.email ??
      group.ownerUserId ??
      "unpaired",
    source: group.primaryAgent?.name ?? group.primaryAgentId ?? "—",
    template: group.primaryAgent?.templateName ?? "—",
    status: group.status,
    action: group.recommendedAction ?? "—",
    reason: group.reasons?.[0] ?? "—",
  }));

  console.log("");
  printTable(rows, [
    { key: "owner", header: "Owner" },
    { key: "source", header: "Source Agent" },
    { key: "template", header: "Template" },
    { key: "status", header: "Status" },
    { key: "action", header: "Action" },
    { key: "reason", header: "Reason" },
  ]);
}

export function registerComputerCommand(program: Command): void {
  const computer = program
    .command("computer")
    .alias("computers")
    .description("Manage ThinkWork Computers and migration operations");

  const migration = computer
    .command("migration")
    .description("Dry-run or apply Agent-to-Computer migration");

  migration
    .command("dry-run")
    .description("Inspect Agent-to-Computer migration candidates")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <uuid>", "Tenant ID")
    .option("--tenant-id <uuid>", "Tenant ID")
    .action(
      async (opts: { stage?: string; tenant?: string; tenantId?: string }) => {
        const { stage, api } = await resolveComputerContext(opts);
        const tenantId = resolveTenantId(opts);
        if (!isJsonMode()) printHeader("computer migration dry-run", stage);

        const response = await apiFetchRaw<MigrationResponse>(
          api.apiUrl,
          api.authSecret,
          "/api/migrations/agents-to-computers",
          {
            method: "POST",
            body: JSON.stringify({ tenantId, mode: "dry-run" }),
          },
        );

        if (!response.ok) {
          printJson(response.body);
          printError(response.body.error ?? `HTTP ${response.status}`);
          process.exit(1);
        }

        printMigrationReport(response.body);
        if (!isJsonMode()) printSuccess("Computer migration dry-run complete");
      },
    );

  migration
    .command("apply")
    .description(
      "Apply Agent-to-Computer migration after reviewing dry-run output",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <uuid>", "Tenant ID")
    .option("--tenant-id <uuid>", "Tenant ID")
    .option("--confirm", "Confirm the migration apply operation")
    .option("--idempotency-key <key>", "Operator-supplied migration run key")
    .action(
      async (opts: {
        stage?: string;
        tenant?: string;
        tenantId?: string;
        confirm?: boolean;
        idempotencyKey?: string;
      }) => {
        const { stage, api } = await resolveComputerContext(opts);
        const tenantId = resolveTenantId(opts);
        if (!opts.confirm) {
          printWarning(
            "Apply is intentionally gated. Re-run with --confirm after reviewing dry-run output.",
          );
          process.exit(1);
        }

        if (!isJsonMode()) printHeader("computer migration apply", stage);
        const response = await apiFetchRaw<MigrationResponse>(
          api.apiUrl,
          api.authSecret,
          "/api/migrations/agents-to-computers",
          {
            method: "POST",
            body: JSON.stringify({
              tenantId,
              mode: "apply",
              idempotencyKey: opts.idempotencyKey,
            }),
          },
        );

        if (!response.ok) {
          printJson(response.body);
          printError(response.body.error ?? `HTTP ${response.status}`);
          if (response.status === 409 && response.body.blockers) {
            if (!isJsonMode()) {
              console.log("");
              console.log(chalk.bold("  Blockers"));
              console.log(JSON.stringify(response.body.blockers, null, 2));
            }
          }
          process.exit(1);
        }

        printMigrationReport(response.body);
        if (!isJsonMode()) {
          printSuccess(
            `Computer migration applied: ${response.body.created?.length ?? 0} created, ${response.body.skipped?.length ?? 0} skipped`,
          );
        }
      },
    );

  const runtime = computer
    .command("runtime")
    .description("Provision and control ECS-backed Computer runtimes");

  for (const action of [
    "provision",
    "start",
    "stop",
    "restart",
    "status",
  ] as const) {
    runtime
      .command(action)
      .description(`${action} a Computer runtime`)
      .option("-s, --stage <name>", "Deployment stage")
      .option("-t, --tenant <uuid>", "Tenant ID")
      .option("--tenant-id <uuid>", "Tenant ID")
      .option("-c, --computer <uuid>", "Computer ID")
      .option("--computer-id <uuid>", "Computer ID")
      .action(
        async (opts: {
          stage?: string;
          tenant?: string;
          tenantId?: string;
          computer?: string;
          computerId?: string;
        }) => {
          const { stage, api } = await resolveComputerContext(opts);
          const tenantId = resolveTenantId(opts);
          const computerId = resolveComputerId(opts);
          if (!isJsonMode()) {
            printHeader(`computer runtime ${action}`, stage);
          }

          const response = await apiFetchRaw<RuntimeResponse>(
            api.apiUrl,
            api.authSecret,
            "/api/computers/manager",
            {
              method: "POST",
              body: JSON.stringify({ action, tenantId, computerId }),
            },
          );

          printJson(response.body);
          if (!response.ok) {
            printError(response.body.error ?? `HTTP ${response.status}`);
            process.exit(1);
          }
          if (!isJsonMode()) {
            printSuccess(`Computer runtime ${action} complete`);
          }
        },
      );
  }

  const task = computer
    .command("task")
    .description("Enqueue work for a ThinkWork Computer runtime");

  task
    .command("enqueue")
    .description("Enqueue a Computer runtime task")
    .option("--type <type>", "Task type")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <uuid>", "Tenant ID")
    .option("--tenant-id <uuid>", "Tenant ID")
    .option("-c, --computer <uuid>", "Computer ID")
    .option("--computer-id <uuid>", "Computer ID")
    .option("--path <path>", "Workspace-relative path for file-write tasks")
    .option("--content <content>", "UTF-8 content for file-write tasks")
    .option("--idempotency-key <key>", "Operator-supplied idempotency key")
    .action(
      async (opts: {
        stage?: string;
        tenant?: string;
        tenantId?: string;
        computer?: string;
        computerId?: string;
        type?: string;
        path?: string;
        content?: string;
        idempotencyKey?: string;
      }) => {
        const { stage, api } = await resolveComputerContext(opts);
        const tenantId = resolveTenantId(opts);
        const computerId = resolveComputerId(opts);
        const taskType = resolveTaskType(opts);
        const input =
          taskType === "workspace_file_write"
            ? { path: opts.path, content: opts.content }
            : undefined;
        if (!isJsonMode()) printHeader("computer task enqueue", stage);

        const response = await apiFetchRaw<TaskResponse>(
          api.apiUrl,
          api.authSecret,
          "/api/computers/runtime/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              tenantId,
              computerId,
              taskType,
              input,
              idempotencyKey: opts.idempotencyKey,
            }),
          },
        );

        printJson(response.body);
        if (!response.ok) {
          printError(response.body.error ?? `HTTP ${response.status}`);
          process.exit(1);
        }
        if (!isJsonMode()) {
          printSuccess(
            `Queued Computer task ${response.body.task?.id ?? taskType}`,
          );
        }
      },
    );
}
