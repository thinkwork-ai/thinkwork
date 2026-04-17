/**
 * `thinkwork scheduled-job ...` — AWS Scheduler-backed recurring jobs that
 * invoke agents on a schedule (independent of routine triggers).
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

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
    .action(() => notYetImplemented("scheduled-job list", 3));

  job
    .command("get <id>")
    .description("Fetch one scheduled job.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("scheduled-job get", 3));

  job
    .command("create [name]")
    .description("Create a new scheduled job. Supports cron() or rate() schedules.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent to wake up")
    .option("--routine <id>", "Or: routine to trigger")
    .option("--schedule <expr>", "EventBridge schedule (cron(…) or rate(…))")
    .option("--timezone <tz>", "IANA timezone (default: UTC)", "UTC")
    .option("--payload <json>", "Payload to pass to the agent/routine")
    .option("--disabled", "Create in disabled state (enable later with update)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork scheduled-job create "Daily ops digest" \\
      --agent agt-editor --schedule "cron(0 9 * * ? *)" --timezone America/New_York

  # rate() — note rate means "every N time from creation", NOT wall-clock.
  $ thinkwork scheduled-job create "Hourly check" --agent agt-check --schedule "rate(1 hour)"
`,
    )
    .action(() => notYetImplemented("scheduled-job create", 3));

  job
    .command("update <id>")
    .description("Update a scheduled job's schedule, payload, or enabled state.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--schedule <expr>")
    .option("--timezone <tz>")
    .option("--payload <json>")
    .option("--enable")
    .option("--disable")
    .action(() => notYetImplemented("scheduled-job update", 3));

  job
    .command("delete <id>")
    .description("Delete a scheduled job. The underlying EventBridge rule is removed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("scheduled-job delete", 3));

  job
    .command("run <id>")
    .description("Trigger a scheduled job immediately (ad-hoc; ignores the schedule).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "Block until the run completes")
    .action(() => notYetImplemented("scheduled-job run", 3));
}
