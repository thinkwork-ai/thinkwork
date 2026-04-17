/**
 * `thinkwork member ...` — tenant membership management (users + agents as
 * members). The existing `thinkwork user invite` stays as a convenience
 * wrapper for the common flow.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerMemberCommand(program: Command): void {
  const mem = program
    .command("member")
    .alias("members")
    .description("List and manage tenant members (users + agents with access).");

  mem
    .command("list")
    .alias("ls")
    .description("List every member of the current tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--principal-type <t>", "Filter: USER | AGENT")
    .option("--role <r>", "Filter by role (member, admin, owner)")
    .action(() => notYetImplemented("member list", 2));

  mem
    .command("invite [email]")
    .description("Invite a user by email. GraphQL path (sends invite email, creates Cognito user).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--role <role>", "member | admin | owner", "member")
    .option("--name <n>", "Optional display name")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork member invite alice@example.com --role admin
  $ thinkwork member invite                                  # interactive
`,
    )
    .action(() => notYetImplemented("member invite", 2));

  mem
    .command("update <memberId>")
    .description("Change a member's role or status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--role <r>")
    .option("--status <s>", "active | suspended")
    .action(() => notYetImplemented("member update", 2));

  mem
    .command("remove <memberId>")
    .description("Remove a member from the tenant. The underlying Cognito user is NOT deleted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("member remove", 2));
}
