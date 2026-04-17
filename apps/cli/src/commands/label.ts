/**
 * `thinkwork label ...` — thread labels (tenant-wide tags).
 *
 * Scaffolded in Phase 0; ships in Phase 1.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerLabelCommand(program: Command): void {
  const label = program
    .command("label")
    .alias("labels")
    .description("Manage tenant-wide thread labels (tags).");

  label
    .command("list")
    .alias("ls")
    .description("List all labels in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("label list", 1));

  label
    .command("create [name]")
    .description("Create a new label. Prompts for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--color <hex>", "Label color as a hex string (e.g. #10b981)")
    .option("--description <text>", "What the label is for")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork label create ops --color "#10b981"
  $ thinkwork label create                     # interactive
`,
    )
    .action(() => notYetImplemented("label create", 1));

  label
    .command("update <id>")
    .description("Rename or recolor an existing label.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--color <hex>")
    .option("--description <text>")
    .action(() => notYetImplemented("label update", 1));

  label
    .command("delete <id>")
    .description("Delete a label. Any thread assignments are removed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(() => notYetImplemented("label delete", 1));
}
