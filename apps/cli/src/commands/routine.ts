/**
 * `thinkwork routine ...` — saved workflows with triggers and run history.
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

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
    .action(() => notYetImplemented("routine list", 3));

  routine
    .command("get <id>")
    .description("Fetch one routine with its triggers and recent runs.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("routine get", 3));

  routine
    .command("create [name]")
    .description("Create a new routine. Walkthrough for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent that runs the routine")
    .option("--team <id>", "Team to route runs to (instead of a single agent)")
    .option("--description <text>")
    .option("--config <json>", "Inline routine config JSON")
    .option("--config-file <path>", "Load routine config from a JSON file")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork routine create "Nightly digest" --agent agt-editor --config-file routines/digest.json
  $ thinkwork routine create                        # interactive walkthrough
`,
    )
    .action(() => notYetImplemented("routine create", 3));

  routine
    .command("update <id>")
    .description("Update a routine.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--status <s>", "ACTIVE | PAUSED | ARCHIVED")
    .option("--agent <id>")
    .option("--team <id>")
    .option("--config-file <path>")
    .action(() => notYetImplemented("routine update", 3));

  routine
    .command("delete <id>")
    .description("Delete a routine. Past runs and triggers are removed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("routine delete", 3));

  routine
    .command("trigger <id>")
    .description("Trigger a routine run now (ad-hoc, outside its scheduled cadence).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "Block until the run finishes, then print result")
    .option("--input <json>", "Optional input payload")
    .action(() => notYetImplemented("routine trigger", 3));

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
    .action(() => notYetImplemented("routine run list", 3));

  run
    .command("get <runId>")
    .description("Fetch one run with its step outputs.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("routine run get", 3));

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
    .action(() => notYetImplemented("routine trigger-config set", 3));

  trigger
    .command("delete <triggerId>")
    .description("Remove a trigger.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("routine trigger-config delete", 3));
}
