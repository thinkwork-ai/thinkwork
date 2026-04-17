/**
 * `thinkwork template ...` — agent templates and template-linked agents.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerTemplateCommand(program: Command): void {
  const tpl = program
    .command("template")
    .alias("templates")
    .description("Manage agent templates — reusable configs you spawn agents from.");

  tpl
    .command("list")
    .alias("ls")
    .description("List templates in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("template list", 2));

  tpl
    .command("get <id>")
    .description("Fetch one template with its linked agents.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("template get", 2));

  tpl
    .command("create [name]")
    .description("Create a new template from a set of config defaults.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from-agent <id>", "Clone config from an existing agent")
    .option("--system-prompt-file <path>", "Prompt markdown path")
    .option("--model <id>", "Default model")
    .option("--description <text>", "What this template is for")
    .addHelpText(
      "after",
      `
Examples:
  # Capture an existing agent's config as a template
  $ thinkwork template create "Ops Analyst" --from-agent agt-ops-1

  # Fresh template
  $ thinkwork template create --system-prompt-file prompts/ops.md --model claude-sonnet-4-6
`,
    )
    .action(() => notYetImplemented("template create", 2));

  tpl
    .command("update <id>")
    .description("Update a template. Linked agents are NOT auto-synced — use `template sync-*`.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--system-prompt-file <path>")
    .option("--model <id>")
    .option("--description <text>")
    .action(() => notYetImplemented("template update", 2));

  tpl
    .command("delete <id>")
    .description("Delete a template. Linked agents are unaffected; they just stop being in sync.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("template delete", 2));

  tpl
    .command("diff <templateId> <agentId>")
    .description("Show what would change if we synced <agentId> to <templateId>.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("template diff", 2));

  tpl
    .command("sync-agent <templateId> <agentId>")
    .description("Apply template changes to one linked agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("template sync-agent", 2));

  tpl
    .command("sync-all <templateId>")
    .description("Apply template changes to every linked agent. Requires confirmation.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .addHelpText(
      "after",
      `
Examples:
  # Preview first
  $ thinkwork template diff tpl-ops agt-ops-1

  # Apply to one agent
  $ thinkwork template sync-agent tpl-ops agt-ops-1

  # Apply to every linked agent
  $ thinkwork template sync-all tpl-ops
`,
    )
    .action(() => notYetImplemented("template sync-all", 2));
}
