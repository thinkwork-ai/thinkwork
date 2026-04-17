/**
 * `thinkwork inbox ...` — approval requests and revision flows.
 *
 * Inbox items are the human-in-the-loop surface: approve an agent's plan,
 * request changes, kick it back for revision. Scaffolded in Phase 0; ships
 * in Phase 1.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerInboxCommand(program: Command): void {
  const inbox = program
    .command("inbox")
    .description("View and act on approval requests routed to you or your workspace.");

  inbox
    .command("list")
    .alias("ls")
    .description("List inbox items, optionally filtered by status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option(
      "--status <s>",
      "PENDING | APPROVED | REJECTED | REVISION_REQUESTED | EXPIRED | CANCELLED (default: PENDING)",
      "PENDING",
    )
    .option("--entity-type <type>", "Filter by entity type (thread, agent, artifact, …)")
    .option("--entity-id <id>", "Filter by entity ID")
    .option("--mine", "Only items routed to the caller")
    .addHelpText(
      "after",
      `
Examples:
  # What's waiting for me to approve?
  $ thinkwork inbox list --mine

  # All pending approvals in the tenant
  $ thinkwork inbox list

  # Closed items for audit
  $ thinkwork inbox list --status APPROVED --json
`,
    )
    .action(() => notYetImplemented("inbox list", 1));

  inbox
    .command("get <id>")
    .description("Fetch one inbox item with its comments, links, and history.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("inbox get", 1));

  inbox
    .command("approve <id>")
    .description("Approve an inbox item. Downstream agents resume.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--notes <text>", "Approval notes (stored on the decision)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork inbox approve ibx-abc
  $ thinkwork inbox approve ibx-abc --notes "Budget confirmed."
`,
    )
    .action(() => notYetImplemented("inbox approve", 1));

  inbox
    .command("reject <id>")
    .description("Reject an inbox item. Downstream agents stop.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--notes <text>", "Rejection reason")
    .action(() => notYetImplemented("inbox reject", 1));

  inbox
    .command("request-revision <id>")
    .description("Ask for changes — the agent gets the item back with your notes.")
    .requiredOption("--notes <text>", "What needs to change")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("inbox request-revision", 1));

  inbox
    .command("resubmit <id>")
    .description("Resubmit a revised inbox item for approval.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--notes <text>", "What changed")
    .action(() => notYetImplemented("inbox resubmit", 1));

  inbox
    .command("cancel <id>")
    .description("Cancel a pending approval request (originator or admin).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("inbox cancel", 1));

  inbox
    .command("comment <id> [content]")
    .description("Add a comment to an inbox item without deciding on it yet.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--file <path>", "Read comment body from a file")
    .action(() => notYetImplemented("inbox comment", 1));
}
