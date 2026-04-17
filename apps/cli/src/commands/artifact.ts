/**
 * `thinkwork artifact ...` — agent-produced markdown outputs (reports,
 * data-views, notes, plans, drafts, digests).
 *
 * Read-only in v1 — create/update/delete stay in the UI where the
 * artifact-editor lives. Scaffolded in Phase 0; ships in Phase 4.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerArtifactCommand(program: Command): void {
  const art = program
    .command("artifact")
    .alias("artifacts")
    .description("List and fetch agent-produced artifacts (notes, reports, data-views, plans, drafts).");

  art
    .command("list")
    .alias("ls")
    .description("List artifacts in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--thread <id>", "Filter by thread")
    .option("--agent <id>", "Filter by producing agent")
    .option(
      "--type <t>",
      "DATA_VIEW | NOTE | REPORT | PLAN | DRAFT | DIGEST",
    )
    .option("--status <s>", "DRAFT | FINAL | SUPERSEDED")
    .option("--limit <n>", "Max rows", "25")
    .option("--cursor <c>", "Pagination cursor")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork artifact list --agent agt-editor --type REPORT
  $ thinkwork artifact list --thread thr-abc --json
`,
    )
    .action(() => notYetImplemented("artifact list", 4));

  art
    .command("get <id>")
    .description("Fetch one artifact. Human mode prints a preview; --json returns the full content.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--raw", "Print only the markdown body to stdout (for piping to pandoc / bat / less)")
    .action(() => notYetImplemented("artifact get", 4));
}
